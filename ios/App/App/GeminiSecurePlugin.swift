import Capacitor
import Foundation
import Security

/**
 Keeps the Gemini credential in the device Keychain and makes Gemini REST calls
 from native code. The WebView never receives the long-lived API key.
 */
@objc(GeminiSecurePlugin)
public class GeminiSecurePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GeminiSecurePlugin"
    public let jsName = "SecureGemini"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "hasApiKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveApiKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeApiKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "generateText", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "generateImage", returnType: CAPPluginReturnPromise)
    ]

    private let service = "com.benjaminlocher.foreheadfrenzy.gemini"
    private let account = "api-key"

    @objc func hasApiKey(_ call: CAPPluginCall) {
        call.resolve(["hasKey": loadKey() != nil])
    }

    @objc func saveApiKey(_ call: CAPPluginCall) {
        guard let key = call.getString("apiKey"), key.count >= 16 else {
            call.reject("Enter a complete Gemini API key.")
            return
        }
        do {
            try saveKey(key)
            call.resolve()
        } catch {
            call.reject("Could not save the Gemini key to Keychain.", nil, error)
        }
    }

    @objc func removeApiKey(_ call: CAPPluginCall) {
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
        guard let key = loadKey() else {
            call.reject("Add a Gemini API key in Settings first.")
            return
        }
        guard let model = call.getString("model"), let prompt = call.getString("prompt") else {
            call.reject("A Gemini model and prompt are required.")
            return
        }
        guard let url = URL(string: "https://generativelanguage.googleapis.com/v1beta/models/\(model):generateContent") else {
            call.reject("Could not create the Gemini request.")
            return
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 75
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(key, forHTTPHeaderField: "x-goog-api-key")
        var body: [String: Any] = ["contents": [["parts": [["text": prompt]]]]]
        if !wantsImage { body["generationConfig"] = ["responseMimeType": "application/json"] }
        do { request.httpBody = try JSONSerialization.data(withJSONObject: body) }
        catch { call.reject("Could not prepare the Gemini request.", nil, error); return }

        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error { call.reject("Gemini request failed: \(error.localizedDescription)"); return }
            guard let http = response as? HTTPURLResponse, let data = data else { call.reject("Gemini returned no response."); return }
            guard (200...299).contains(http.statusCode) else {
                let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? [String: Any]
                call.reject((message?["message"] as? String) ?? "Gemini request failed (\(http.statusCode)).")
                return
            }
            guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let candidates = json["candidates"] as? [[String: Any]],
                  let content = candidates.first?["content"] as? [String: Any],
                  let parts = content["parts"] as? [[String: Any]] else { call.reject("Gemini returned an unexpected response."); return }
            if wantsImage, let inline = parts.first(where: { $0["inlineData"] != nil })?["inlineData"] as? [String: Any], let base64 = inline["data"] as? String {
                call.resolve(["base64": base64, "mimeType": inline["mimeType"] as? String ?? "image/png"])
            } else if let text = parts.compactMap({ $0["text"] as? String }).joined(separator: "\n").nilIfEmpty {
                call.resolve(["text": text])
            } else { call.reject("Gemini did not return the requested content.") }
        }.resume()
    }

    private func saveKey(_ key: String) throws {
        let base: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
        SecItemDelete(base as CFDictionary)
        var item = base
        item[kSecValueData as String] = key.data(using: .utf8)
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(item as CFDictionary, nil)
        guard status == errSecSuccess else { throw NSError(domain: "Keychain", code: Int(status)) }
    }

    private func loadKey() -> String? {
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
