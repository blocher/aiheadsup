package com.benjaminlocher.foreheadfrenzy;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;

import androidx.browser.customtabs.CustomTabsIntent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Android counterpart of ios/App/App/GeminiSecurePlugin.swift (same JS name and
 * methods). Keeps each AI provider credential encrypted with Android Keystore
 * and makes the provider REST calls natively, so the WebView never receives the
 * long-lived API keys. Also provides the native half of Sign in with ChatGPT: a
 * 127.0.0.1 callback listener, the Custom Tab sign-in page, and Keystore
 * storage for the session.
 */
@CapacitorPlugin(name = "SecureAi")
public class SecureAiPlugin extends Plugin {
    private static final String CHATGPT_SESSION = "chatgpt-session";
    // Brings the user back from the Custom Tab; handled by the intent filter on
    // MainActivity. This is not the OAuth redirect, which stays on 127.0.0.1.
    private static final String RETURN_URL = "intent://chatgpt-return#Intent;scheme=com.benjaminlocher.foreheadfrenzy;package=com.benjaminlocher.foreheadfrenzy;end";
    private static final long CANCEL_GRACE_MS = 1500;

    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private SecretStore store;
    private ChatGptLoopbackServer chatGptServer;
    private PluginCall pendingAuthCall;
    private boolean authLeftApp = false;

    @Override
    public void load() {
        store = new SecretStore(getContext());
    }

    @Override
    protected void handleOnDestroy() {
        stopChatGptServer();
        executor.shutdown();
    }

    // MARK: API keys

    private static String keyName(String provider) {
        if ("gemini".equals(provider)) return "api-key.gemini";
        if ("openai".equals(provider)) return "api-key.openai";
        return null;
    }

    private static String label(String provider) {
        return "openai".equals(provider) ? "OpenAI" : "Gemini";
    }

    @PluginMethod
    public void hasApiKey(PluginCall call) {
        String name = keyName(call.getString("provider"));
        if (name == null) { call.reject("Unknown AI provider."); return; }
        JSObject result = new JSObject();
        result.put("hasKey", store.get(name) != null);
        call.resolve(result);
    }

    @PluginMethod
    public void saveApiKey(PluginCall call) {
        String provider = call.getString("provider");
        String name = keyName(provider);
        if (name == null) { call.reject("Unknown AI provider."); return; }
        String key = call.getString("apiKey");
        if (key == null || key.length() < 16) { call.reject("Enter a complete " + label(provider) + " API key."); return; }
        try {
            store.put(name, key);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not save the " + label(provider) + " key securely.", e);
        }
    }

    @PluginMethod
    public void removeApiKey(PluginCall call) {
        String name = keyName(call.getString("provider"));
        if (name == null) { call.reject("Unknown AI provider."); return; }
        store.remove(name);
        call.resolve();
    }

    @PluginMethod
    public void generateText(PluginCall call) {
        generate(call, false);
    }

    @PluginMethod
    public void generateImage(PluginCall call) {
        generate(call, true);
    }

    private void generate(PluginCall call, boolean wantsImage) {
        String provider = call.getString("provider");
        String name = keyName(provider);
        if (name == null) { call.reject("Unknown AI provider."); return; }
        String model = call.getString("model");
        String prompt = call.getString("prompt");
        if (model == null || prompt == null) { call.reject("A model and prompt are required."); return; }
        executor.execute(() -> {
            String key = store.get(name);
            if (key == null) { call.reject("Add a " + label(provider) + " API key in Settings first."); return; }
            try {
                call.resolve("openai".equals(provider)
                    ? openAi(key, model, prompt, wantsImage)
                    : gemini(key, model, prompt, wantsImage));
            } catch (ProviderException e) {
                call.reject(e.getMessage());
            } catch (Exception e) {
                call.reject(label(provider) + " request failed: " + e.getMessage());
            }
        });
    }

    private JSObject gemini(String key, String model, String prompt, boolean wantsImage) throws Exception {
        JSONObject body = new JSONObject()
            .put("contents", new JSONArray().put(new JSONObject().put("parts", new JSONArray().put(new JSONObject().put("text", prompt)))));
        if (!wantsImage) body.put("generationConfig", new JSONObject().put("responseMimeType", "application/json"));
        JSONObject json = postJson("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent", "x-goog-api-key", key, body, 75_000, "Gemini");
        JSONArray candidates = json.optJSONArray("candidates");
        JSONObject content = candidates == null ? null : candidates.optJSONObject(0) == null ? null : candidates.optJSONObject(0).optJSONObject("content");
        JSONArray parts = content == null ? null : content.optJSONArray("parts");
        if (parts == null) throw new ProviderException("Gemini returned an unexpected response.");
        JSObject result = new JSObject();
        if (wantsImage) {
            for (int i = 0; i < parts.length(); i++) {
                JSONObject inline = parts.optJSONObject(i) == null ? null : parts.optJSONObject(i).optJSONObject("inlineData");
                if (inline != null && !inline.optString("data").isEmpty()) {
                    result.put("base64", inline.optString("data"));
                    result.put("mimeType", inline.optString("mimeType", "image/png"));
                    return result;
                }
            }
            throw new ProviderException("Gemini did not return the requested content.");
        }
        List<String> texts = new ArrayList<>();
        for (int i = 0; i < parts.length(); i++) {
            JSONObject part = parts.optJSONObject(i);
            if (part != null && part.has("text")) texts.add(part.optString("text"));
        }
        String text = String.join("\n", texts);
        if (text.isEmpty()) throw new ProviderException("Gemini did not return the requested content.");
        result.put("text", text);
        return result;
    }

    private JSObject openAi(String key, String model, String prompt, boolean wantsImage) throws Exception {
        JSObject result = new JSObject();
        if (wantsImage) {
            JSONObject body = new JSONObject().put("model", model).put("prompt", prompt).put("size", "1024x1536");
            JSONObject json = postJson("https://api.openai.com/v1/images/generations", "Authorization", "Bearer " + key, body, 120_000, "OpenAI");
            JSONArray data = json.optJSONArray("data");
            String base64 = data == null || data.optJSONObject(0) == null ? "" : data.optJSONObject(0).optString("b64_json");
            if (base64.isEmpty()) throw new ProviderException("OpenAI did not return an image.");
            result.put("base64", base64);
            result.put("mimeType", "image/png");
            return result;
        }
        JSONObject body = new JSONObject()
            .put("model", model)
            .put("messages", new JSONArray().put(new JSONObject().put("role", "user").put("content", prompt)))
            .put("response_format", new JSONObject().put("type", "json_object"));
        JSONObject json = postJson("https://api.openai.com/v1/chat/completions", "Authorization", "Bearer " + key, body, 120_000, "OpenAI");
        JSONArray choices = json.optJSONArray("choices");
        JSONObject message = choices == null || choices.optJSONObject(0) == null ? null : choices.optJSONObject(0).optJSONObject("message");
        String text = message == null ? "" : message.optString("content");
        if (text.isEmpty()) throw new ProviderException("OpenAI did not return the requested content.");
        result.put("text", text);
        return result;
    }

    private static JSONObject postJson(String endpoint, String authHeader, String authValue, JSONObject body, int timeoutMs, String label) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(endpoint).openConnection();
        try {
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(20_000);
            connection.setReadTimeout(timeoutMs);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty(authHeader, authValue);
            try (OutputStream out = connection.getOutputStream()) {
                out.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }
            int status = connection.getResponseCode();
            boolean ok = status >= 200 && status < 300;
            String text = readAll(ok ? connection.getInputStream() : connection.getErrorStream());
            JSONObject json;
            try {
                json = new JSONObject(text);
            } catch (Exception e) {
                json = null;
            }
            if (!ok) {
                JSONObject error = json == null ? null : json.optJSONObject("error");
                String message = error == null ? "" : error.optString("message");
                throw new ProviderException(message.isEmpty() ? label + " request failed (" + status + ")." : message);
            }
            if (json == null) throw new ProviderException(label + " returned an unexpected response.");
            return json;
        } finally {
            connection.disconnect();
        }
    }

    private static String readAll(InputStream in) throws Exception {
        if (in == null) return "";
        try (InputStream stream = in; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = stream.read(buffer)) >= 0) out.write(buffer, 0, read);
            return out.toString("UTF-8");
        }
    }

    private static final class ProviderException extends Exception {
        ProviderException(String message) { super(message); }
    }

    // MARK: Sign in with ChatGPT

    @PluginMethod
    public void prepareChatGptCallback(PluginCall call) {
        stopChatGptServer();
        ChatGptLoopbackServer server = new ChatGptLoopbackServer(RETURN_URL);
        try {
            server.start();
        } catch (Exception e) {
            call.reject("Could not prepare ChatGPT sign-in: " + e.getMessage());
            return;
        }
        synchronized (this) { chatGptServer = server; }
        JSObject result = new JSObject();
        result.put("redirectUri", server.redirectUri());
        call.resolve(result);
    }

    @PluginMethod
    public void openChatGptAuthorization(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !url.startsWith("https://")) { call.reject("A ChatGPT sign-in URL is required."); return; }
        ChatGptLoopbackServer server;
        synchronized (this) {
            server = chatGptServer;
            if (server == null) { call.reject("ChatGPT sign-in was not prepared. Please try again."); return; }
            if (pendingAuthCall != null) pendingAuthCall.reject("ChatGPT sign-in was restarted.", "cancelled");
            pendingAuthCall = call;
            authLeftApp = false;
        }
        Uri uri = Uri.parse(url);
        // Only a callback carrying this attempt's state completes sign-in.
        server.expect(uri.getQueryParameter("state"), (callbackUrl) -> finishChatGptAuth(callbackUrl, null));
        getActivity().runOnUiThread(() -> {
            try {
                new CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(getActivity(), uri);
            } catch (ActivityNotFoundException noCustomTabs) {
                try {
                    getActivity().startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (ActivityNotFoundException noBrowser) {
                    finishChatGptAuth(null, "No browser is available to sign in with ChatGPT.");
                }
            }
        });
    }

    private void finishChatGptAuth(String callbackUrl, String errorMessage) {
        PluginCall call;
        synchronized (this) {
            call = pendingAuthCall;
            pendingAuthCall = null;
        }
        if (call == null) return;
        if (callbackUrl != null) {
            JSObject result = new JSObject();
            result.put("callbackUrl", callbackUrl);
            call.resolve(result);
            bringAppToFront();
        } else {
            call.reject(errorMessage == null ? "ChatGPT sign-in was cancelled." : errorMessage, "cancelled");
        }
        stopChatGptServer();
    }

    // Best effort: Android may block starting an activity from the background,
    // in which case the "Return to Forehead Frenzy" button on the callback page
    // brings the user back.
    private void bringAppToFront() {
        mainHandler.post(() -> {
            try {
                Intent intent = new Intent(getContext(), MainActivity.class);
                intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                getActivity().startActivity(intent);
            } catch (Exception ignored) {
                // The return button on the callback page covers this.
            }
        });
    }

    @Override
    protected void handleOnPause() {
        synchronized (this) {
            if (pendingAuthCall != null) authLeftApp = true;
        }
    }

    // Back in the app with no callback: the user closed the sign-in page. Wait
    // briefly in case the callback is still arriving.
    @Override
    protected void handleOnResume() {
        boolean check;
        synchronized (this) { check = pendingAuthCall != null && authLeftApp; }
        if (!check) return;
        mainHandler.postDelayed(() -> {
            boolean stillPending;
            synchronized (this) { stillPending = pendingAuthCall != null; }
            if (stillPending) finishChatGptAuth(null, "ChatGPT sign-in was cancelled.");
        }, CANCEL_GRACE_MS);
    }

    private void stopChatGptServer() {
        ChatGptLoopbackServer server;
        synchronized (this) {
            server = chatGptServer;
            chatGptServer = null;
        }
        if (server != null) server.stop();
    }

    @PluginMethod
    public void saveChatGptSession(PluginCall call) {
        String value = call.getString("value");
        if (value == null || value.isEmpty()) { call.reject("A ChatGPT session is required."); return; }
        try {
            store.put(CHATGPT_SESSION, value);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not save the ChatGPT session securely.", e);
        }
    }

    @PluginMethod
    public void loadChatGptSession(PluginCall call) {
        String value = store.get(CHATGPT_SESSION);
        JSObject result = new JSObject();
        if (value != null) result.put("value", value);
        call.resolve(result);
    }

    @PluginMethod
    public void clearChatGptSession(PluginCall call) {
        store.remove(CHATGPT_SESSION);
        call.resolve();
    }
}
