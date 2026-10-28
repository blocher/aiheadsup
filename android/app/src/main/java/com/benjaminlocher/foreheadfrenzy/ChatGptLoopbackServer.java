package com.benjaminlocher.foreheadfrenzy;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.UnsupportedEncodingException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/**
 * A one-shot HTTP listener bound to 127.0.0.1 that waits for GET /auth/callback.
 *
 * OpenAI's ChatGPT plan-usage sign-in only redirects to an HTTP loopback
 * callback, so the app serves it itself while the sign-in page is open in a
 * Custom Tab. Plain Java (no Android APIs) so it can be unit tested on the JVM.
 */
public final class ChatGptLoopbackServer {
    public static final String CALLBACK_PATH = "/auth/callback";
    private static final int MAX_REQUEST_BYTES = 32 * 1024;
    private static final int READ_TIMEOUT_MS = 10_000;

    public interface Listener {
        void onCallback(String callbackUrl);
    }

    private final String returnUrl;
    private ServerSocket socket;
    private Thread thread;
    private volatile String expectedState;
    private volatile Listener listener;
    private volatile boolean delivered = false;

    /** @param returnUrl link shown on the success page to bring the user back to the app. */
    public ChatGptLoopbackServer(String returnUrl) {
        this.returnUrl = returnUrl;
    }

    /** Binds to 127.0.0.1 on a free port and returns that port. */
    public synchronized int start() throws IOException {
        socket = new ServerSocket();
        socket.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0));
        thread = new Thread(this::acceptLoop, "chatgpt-callback");
        thread.setDaemon(true);
        thread.start();
        return socket.getLocalPort();
    }

    public int port() {
        return socket == null ? 0 : socket.getLocalPort();
    }

    public String redirectUri() {
        return "http://127.0.0.1:" + port() + CALLBACK_PATH;
    }

    /** Only a callback carrying this state is accepted. */
    public void expect(String state, Listener listener) {
        this.expectedState = state;
        this.listener = listener;
    }

    public synchronized void stop() {
        listener = null;
        if (socket != null) {
            try { socket.close(); } catch (IOException ignored) { }
            socket = null;
        }
    }

    private void acceptLoop() {
        ServerSocket server = socket;
        while (server != null && !server.isClosed()) {
            try (Socket client = server.accept()) {
                client.setSoTimeout(READ_TIMEOUT_MS);
                handle(client);
            } catch (IOException ignored) {
                // Closed by stop(), or one bad connection; keep serving until stopped.
            }
        }
    }

    private void handle(Socket client) throws IOException {
        String head = readHead(client.getInputStream());
        String[] lines = head.split("\r\n");
        String[] requestLine = lines.length > 0 ? lines[0].split(" ") : new String[0];
        String host = null;
        for (int i = 1; i < lines.length; i++) {
            if (lines[i].toLowerCase(Locale.ROOT).startsWith("host:")) host = lines[i].substring(5).trim();
        }
        int port = port();
        String target = requestLine.length >= 2 ? requestLine[1] : "";
        URI uri;
        try {
            uri = new URI("http://127.0.0.1:" + port + target);
        } catch (Exception e) {
            uri = null;
        }
        if (requestLine.length < 2 || !"GET".equals(requestLine[0]) || !("127.0.0.1:" + port).equals(host)
                || uri == null || !CALLBACK_PATH.equals(uri.getPath())) {
            send(client.getOutputStream(), "404 Not Found", "Not found");
            return;
        }
        String state = queryParam(uri.getRawQuery(), "state");
        String expected = expectedState;
        if (delivered || expected == null || !expected.equals(state)) {
            // Unrelated loopback requests must not end the pending sign-in.
            send(client.getOutputStream(), "400 Bad Request", "This sign-in link does not match. Return to Forehead Frenzy and try again.");
            return;
        }
        delivered = true;
        send(client.getOutputStream(), "200 OK", successPage());
        Listener current = listener;
        if (current != null) current.onCallback(uri.toString());
    }

    private String successPage() {
        String link = returnUrl == null ? "" : returnUrl.replace("&", "&amp;").replace("\"", "&quot;");
        String button = link.isEmpty() ? "" : "<p><a href=\"" + link + "\" style=\"display:inline-block;padding:14px 22px;border-radius:14px;background:#713fd4;color:#fff;text-decoration:none;font-weight:700\">Return to Forehead Frenzy</a></p>";
        return "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\">"
            + "<title>Return to Forehead Frenzy</title><body style=\"font:17px system-ui;margin:20vh 24px;text-align:center\">"
            + "<h1>Return to Forehead Frenzy</h1><p>Your ChatGPT connection is being finished in the app.</p>" + button + "</body></html>";
    }

    static String queryParam(String rawQuery, String name) {
        if (rawQuery == null) return null;
        String found = null;
        for (String pair : rawQuery.split("&")) {
            int eq = pair.indexOf('=');
            String key = decode(eq >= 0 ? pair.substring(0, eq) : pair);
            if (!name.equals(key)) continue;
            if (found != null) return null; // A repeated parameter is ambiguous; reject it.
            found = eq >= 0 ? decode(pair.substring(eq + 1)) : "";
        }
        return found;
    }

    private static String decode(String value) {
        try {
            return URLDecoder.decode(value, "UTF-8");
        } catch (UnsupportedEncodingException | IllegalArgumentException e) {
            return null;
        }
    }

    private static String readHead(InputStream in) throws IOException {
        byte[] buffer = new byte[MAX_REQUEST_BYTES];
        int length = 0;
        while (length < buffer.length) {
            int read = in.read(buffer, length, buffer.length - length);
            if (read < 0) break;
            length += read;
            String soFar = new String(buffer, 0, length, StandardCharsets.ISO_8859_1);
            if (soFar.contains("\r\n\r\n")) break;
        }
        return new String(buffer, 0, length, StandardCharsets.ISO_8859_1);
    }

    private static void send(OutputStream out, String status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        String headers = "HTTP/1.1 " + status + "\r\n"
            + "Content-Type: text/html; charset=utf-8\r\n"
            + "Cache-Control: no-store\r\n"
            + "Referrer-Policy: no-referrer\r\n"
            + "Connection: close\r\n"
            + "Content-Length: " + bytes.length + "\r\n\r\n";
        out.write(headers.getBytes(StandardCharsets.ISO_8859_1));
        out.write(bytes);
        out.flush();
    }
}
