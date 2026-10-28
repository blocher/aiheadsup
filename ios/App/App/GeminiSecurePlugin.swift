import AuthenticationServices
import Capacitor
import Foundation
import Network
import Security

/**
 Keeps each AI provider credential in the device Keychain and makes the provider
 REST calls from native code. The WebView never receives the long-lived API keys.
 Supports Google Gemini and OpenAI, plus the native half of Sign in with ChatGPT
 (loopback callback listener and Keychain session storage).
 */
@objc(AiSecurePlugin)
public class AiSecurePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AiSecurePlugin"
    public let jsName = "SecureAi"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "hasApiKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveApiKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeApiKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "generateText", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "generateImage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "prepareChatGptCallback", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openChatGptAuthorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveChatGptSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "loadChatGptSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearChatGptSession", returnType: CAPPluginReturnPromise)
    ]

    private let account = "api-key"
    private let chatGptSessionService = "com.dailyoffice2019.foreheadfrenzy.chatgpt-session"
    private var chatGptListener: ChatGptLoopbackListener?
    private var chatGptAuthSession: ASWebAuthenticationSession?

    private func service(for provider: String) -> String? {
        switch provider {
        // Unchanged service id so previously saved Gemini keys keep working.
        case "gemini": return "com.dailyoffice2019.foreheadfrenzy.gemini"
        case "openai": return "com.dailyoffice2019.foreheadfrenzy.openai"
        default: return nil
        }
    }

    private func label(for provider: String) -> String {
        provider == "openai" ? "OpenAI" : "Gemini"
    }

    @objc func hasApiKey(_ call: CAPPluginCall) {
        guard let provider = call.getString("provider"), let service = service(for: provider) else {
            call.reject("Unknown AI provider.")
            return
        }
        call.resolve(["hasKey": loadKey(service: service) != nil])
    }

    @objc func saveApiKey(_ call: CAPPluginCall) {
        guard let provider = call.getString("provider"), let service = service(for: provider) else {
            call.reject("Unknown AI provider.")
            return
        }
        guard let key = call.getString("apiKey"), key.count >= 16 else {
            call.reject("Enter a complete \(label(for: provider)) API key.")
            return
        }
        do {
            try saveKey(key, service: service)
            call.resolve()
        } catch {
            call.reject("Could not save the \(label(for: provider)) key to Keychain.", nil, error)
        }
    }

    @objc func removeApiKey(_ call: CAPPluginCall) {
        guard let provider = call.getString("provider"), let service = service(for: provider) else {
            call.reject("Unknown AI provider.")
            return
        }
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
        SecItemDelete(query as CFDictionary)
        call.resolve()
    }

    @objc func generateText(_ call: CAPPluginCall) {
        generate(call, wantsImage: false)
    }

    @objc func generateImage(_ call: CAPPluginCall) {
        generate(call, wantsImage: true)
    }

    private func generate(_ call: CAPPluginCall, wantsImage: Bool) {
        guard let provider = call.getString("provider"), let service = service(for: provider) else {
            call.reject("Unknown AI provider.")
            return
        }
        guard let key = loadKey(service: service) else {
            call.reject("Add a \(label(for: provider)) API key in Settings first.")
            return
        }
        guard let model = call.getString("model"), let prompt = call.getString("prompt") else {
            call.reject("A model and prompt are required.")
            return
        }
        let request: URLRequest?
        switch provider {
        case "openai": request = openAIRequest(key: key, model: model, prompt: prompt, wantsImage: wantsImage)
        default: request = geminiRequest(key: key, model: model, prompt: prompt, wantsImage: wantsImage)
        }
        guard let request = request else {
            call.reject("Could not create the \(label(for: provider)) request.")
            return
        }

        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error { call.reject("\(self.label(for: provider)) request failed: \(error.localizedDescription)"); return }
            guard let http = response as? HTTPURLResponse, let data = data else { call.reject("\(self.label(for: provider)) returned no response."); return }
            guard (200...299).contains(http.statusCode) else {
                let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
                let message = (json?["error"] as? [String: Any])?["message"] as? String
                call.reject(message ?? "\(self.label(for: provider)) request failed (\(http.statusCode)).")
                return
            }
            guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                call.reject("\(self.label(for: provider)) returned an unexpected response.")
                return
            }
            if provider == "openai" {
                self.resolveOpenAI(call, json: json, wantsImage: wantsImage, provider: provider)
            } else {
                self.resolveGemini(call, json: json, wantsImage: wantsImage, provider: provider)
            }
        }.resume()
    }

    private func geminiRequest(key: String, model: String, prompt: String, wantsImage: Bool) -> URLRequest? {
        guard let url = URL(string: "https://generativelanguage.googleapis.com/v1beta/models/\(model):generateContent") else { return nil }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 75
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(key, forHTTPHeaderField: "x-goog-api-key")
        var body: [String: Any] = ["contents": [["parts": [["text": prompt]]]]]
        if !wantsImage { body["generationConfig"] = ["responseMimeType": "application/json"] }
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        return request.httpBody == nil ? nil : request
    }

    private func openAIRequest(key: String, model: String, prompt: String, wantsImage: Bool) -> URLRequest? {
        let endpoint = wantsImage ? "https://api.openai.com/v1/images/generations" : "https://api.openai.com/v1/chat/completions"
        guard let url = URL(string: endpoint) else { return nil }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 120
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        let body: [String: Any] = wantsImage
            ? ["model": model, "prompt": prompt, "size": "1024x1536"]
            : ["model": model, "messages": [["role": "user", "content": prompt]], "response_format": ["type": "json_object"]]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        return request.httpBody == nil ? nil : request
    }

    private func resolveGemini(_ call: CAPPluginCall, json: [String: Any], wantsImage: Bool, provider: String) {
        guard let candidates = json["candidates"] as? [[String: Any]],
              let content = candidates.first?["content"] as? [String: Any],
              let parts = content["parts"] as? [[String: Any]] else {
            call.reject("\(label(for: provider)) returned an unexpected response.")
            return
        }
        if wantsImage, let inline = parts.first(where: { $0["inlineData"] != nil })?["inlineData"] as? [String: Any], let base64 = inline["data"] as? String {
            call.resolve(["base64": base64, "mimeType": inline["mimeType"] as? String ?? "image/png"])
        } else if let text = parts.compactMap({ $0["text"] as? String }).joined(separator: "\n").nilIfEmpty {
            call.resolve(["text": text])
        } else {
            call.reject("\(label(for: provider)) did not return the requested content.")
        }
    }

    private func resolveOpenAI(_ call: CAPPluginCall, json: [String: Any], wantsImage: Bool, provider: String) {
        if wantsImage {
            if let images = json["data"] as? [[String: Any]], let base64 = images.first?["b64_json"] as? String {
                call.resolve(["base64": base64, "mimeType": "image/png"])
            } else {
                call.reject("\(label(for: provider)) did not return an image.")
            }
            return
        }
        guard let choices = json["choices"] as? [[String: Any]],
              let message = choices.first?["message"] as? [String: Any],
              let text = (message["content"] as? String)?.nilIfEmpty else {
            call.reject("\(label(for: provider)) did not return the requested content.")
            return
        }
        call.resolve(["text": text])
    }

    private func saveKey(_ key: String, service: String) throws {
        let base: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
        SecItemDelete(base as CFDictionary)
        var item = base
        item[kSecValueData as String] = key.data(using: .utf8)
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(item as CFDictionary, nil)
        guard status == errSecSuccess else { throw NSError(domain: "Keychain", code: Int(status)) }
    }

    private func loadKey(service: String) -> String? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account, kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}

// MARK: - Sign in with ChatGPT

/*
 OpenAI's ChatGPT plan-usage sign-in only redirects to an HTTP loopback callback
 (http://127.0.0.1:<port>/auth/callback); app URL schemes are not accepted. So
 the app listens on 127.0.0.1 while the system sign-in sheet
 (ASWebAuthenticationSession) is open. The app stays in the foreground, the
 sheet's redirect reaches the listener, and the sheet is then dismissed. The
 OAuth exchange itself runs in JS (src/lib/chatgpt-session.js); tokens are kept
 in the Keychain between launches.
 */
extension AiSecurePlugin: ASWebAuthenticationPresentationContextProviding {
    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        bridge?.webView?.window ?? ASPresentationAnchor()
    }

    @objc func prepareChatGptCallback(_ call: CAPPluginCall) {
        chatGptListener?.stop()
        let listener = ChatGptLoopbackListener()
        chatGptListener = listener
        listener.start { result in
            switch result {
            case .success(let port):
                call.resolve(["redirectUri": "http://127.0.0.1:\(port)\(ChatGptLoopbackListener.callbackPath)"])
            case .failure(let error):
                call.reject("Could not prepare ChatGPT sign-in: \(error.localizedDescription)")
            }
        }
    }

    @objc func openChatGptAuthorization(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"), let url = URL(string: urlString), url.scheme == "https" else {
            call.reject("A ChatGPT sign-in URL is required.")
            return
        }
        guard let listener = chatGptListener else {
            call.reject("ChatGPT sign-in was not prepared. Please try again.")
            return
        }
        // Only a callback carrying this attempt's state completes the sheet.
        listener.expectedState = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "state" })?.value

        DispatchQueue.main.async {
            var finished = false
            let finish: (URL?, String?, String?) -> Void = { callbackURL, message, code in
                if finished { return }
                finished = true
                if let callbackURL = callbackURL {
                    call.resolve(["callbackUrl": callbackURL.absoluteString])
                } else {
                    call.reject(message ?? "ChatGPT sign-in failed.", code)
                }
                // Let the "return to the app" page render briefly, then close.
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                    self.chatGptAuthSession?.cancel()
                    self.chatGptAuthSession = nil
                    self.chatGptListener?.stop()
                    self.chatGptListener = nil
                }
            }
            listener.onCallback = { callbackURL in
                DispatchQueue.main.async { finish(callbackURL, nil, nil) }
            }
            // No custom scheme: completion only fires when the user closes the
            // sheet or it fails; success arrives through the loopback listener.
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: nil) { _, error in
                DispatchQueue.main.async {
                    if let authError = error as? ASWebAuthenticationSessionError, authError.code == .canceledLogin {
                        finish(nil, "ChatGPT sign-in was cancelled.", "cancelled")
                    } else {
                        finish(nil, error?.localizedDescription ?? "ChatGPT sign-in closed before it finished.", "cancelled")
                    }
                }
            }
            session.presentationContextProvider = self
            // Share Safari's cookies so an existing ChatGPT login is reused.
            session.prefersEphemeralWebBrowserSession = false
            self.chatGptAuthSession = session
            if !session.start() {
                finish(nil, "Could not open ChatGPT sign-in.", nil)
            }
        }
    }

    @objc func saveChatGptSession(_ call: CAPPluginCall) {
        guard let value = call.getString("value"), !value.isEmpty else {
            call.reject("A ChatGPT session is required.")
            return
        }
        do {
            try saveKey(value, service: chatGptSessionService)
            call.resolve()
        } catch {
            call.reject("Could not save the ChatGPT session to Keychain.", nil, error)
        }
    }

    @objc func loadChatGptSession(_ call: CAPPluginCall) {
        if let value = loadKey(service: chatGptSessionService) {
            call.resolve(["value": value])
        } else {
            call.resolve([:])
        }
    }

    @objc func clearChatGptSession(_ call: CAPPluginCall) {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: chatGptSessionService, kSecAttrAccount as String: account]
        SecItemDelete(query as CFDictionary)
        call.resolve()
    }
}

/// A one-shot HTTP listener bound to 127.0.0.1 that waits for GET /auth/callback.
final class ChatGptLoopbackListener {
    static let callbackPath = "/auth/callback"

    private let queue = DispatchQueue(label: "com.benjaminlocher.foreheadfrenzy.chatgpt-callback")
    private var listener: NWListener?
    private var port: UInt16 = 0
    private var delivered = false
    var expectedState: String?
    var onCallback: ((URL) -> Void)?

    func start(completion: @escaping (Result<UInt16, Error>) -> Void) {
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = NWEndpoint.hostPort(host: .ipv4(.loopback), port: .any)
        let listener: NWListener
        do {
            listener = try NWListener(using: parameters)
        } catch {
            completion(.failure(error))
            return
        }
        self.listener = listener
        var reported = false
        listener.stateUpdateHandler = { [weak self] state in
            guard let self = self else { return }
            switch state {
            case .ready:
                guard !reported, let port = listener.port?.rawValue else { return }
                reported = true
                self.port = port
                completion(.success(port))
            case .failed(let error):
                if !reported {
                    reported = true
                    completion(.failure(error))
                }
                listener.cancel()
            default:
                break
            }
        }
        listener.newConnectionHandler = { [weak self] connection in
            self?.handle(connection)
        }
        listener.start(queue: queue)
    }

    func stop() {
        // Clear the handlers too: they capture the listener.
        listener?.stateUpdateHandler = nil
        listener?.newConnectionHandler = nil
        listener?.cancel()
        listener = nil
        onCallback = nil
    }

    private func handle(_ connection: NWConnection) {
        connection.start(queue: queue)
        receive(on: connection, buffer: Data())
    }

    private func receive(on connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 16_384) { [weak self] data, _, isComplete, error in
            guard let self = self else { connection.cancel(); return }
            var buffer = buffer
            if let data = data { buffer.append(data) }
            let headerEnd = Data("\r\n\r\n".utf8)
            if buffer.range(of: headerEnd) != nil || isComplete || error != nil || buffer.count > 32_768 {
                self.respond(to: buffer, on: connection)
            } else {
                self.receive(on: connection, buffer: buffer)
            }
        }
    }

    private func respond(to request: Data, on connection: NWConnection) {
        let text = String(decoding: request, as: UTF8.self)
        let lines = text.components(separatedBy: "\r\n")
        let requestLine = lines.first?.split(separator: " ").map(String.init) ?? []
        let host = lines.dropFirst()
            .first(where: { $0.lowercased().hasPrefix("host:") })
            .map { $0.dropFirst(5).trimmingCharacters(in: .whitespaces) }
        guard requestLine.count >= 2, requestLine[0] == "GET",
              host == "127.0.0.1:\(port)",
              let callbackURL = URL(string: "http://127.0.0.1:\(port)\(requestLine[1])"),
              callbackURL.path == Self.callbackPath else {
            send(status: "404 Not Found", body: "Not found", on: connection)
            return
        }
        let state = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "state" })?.value
        guard !delivered, let expected = expectedState, state == expected else {
            // Unrelated loopback requests must not end the pending sign-in.
            send(status: "400 Bad Request", body: "This sign-in link does not match. Return to Forehead Frenzy and try again.", on: connection)
            return
        }
        delivered = true
        send(status: "200 OK", body: "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>Return to Forehead Frenzy</title><body style=\"font:17px system-ui;margin:20vh 24px;text-align:center\"><h1>Return to Forehead Frenzy</h1><p>Finishing your ChatGPT connection…</p></body></html>", on: connection)
        onCallback?(callbackURL)
    }

    private func send(status: String, body: String, on connection: NWConnection) {
        let bodyData = Data(body.utf8)
        var response = Data("HTTP/1.1 \(status)\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\nContent-Length: \(bodyData.count)\r\n\r\n".utf8)
        response.append(bodyData)
        connection.send(content: response, completion: .contentProcessed { _ in connection.cancel() })
    }
}
