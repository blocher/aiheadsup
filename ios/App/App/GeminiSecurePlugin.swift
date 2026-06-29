import Capacitor
import Foundation
import Security

/**
 Keeps each AI provider credential in the device Keychain and makes the provider
 REST calls from native code. The WebView never receives the long-lived API keys.
 Supports Google Gemini and OpenAI.
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
        CAPPluginMethod(name: "generateImage", returnType: CAPPluginReturnPromise)
    ]

    private let account = "api-key"

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
