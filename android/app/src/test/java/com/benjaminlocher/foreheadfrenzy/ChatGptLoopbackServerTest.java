package com.benjaminlocher.foreheadfrenzy;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

public class ChatGptLoopbackServerTest {
    private ChatGptLoopbackServer server;
    private final AtomicReference<String> delivered = new AtomicReference<>();
    private final CountDownLatch latch = new CountDownLatch(1);

    @Before
    public void setUp() throws Exception {
        server = new ChatGptLoopbackServer("intent://chatgpt-return#Intent;scheme=x;end");
        server.start();
        server.expect("good-state", (url) -> { delivered.set(url); latch.countDown(); });
    }

    @After
    public void tearDown() {
        server.stop();
    }

    // Sends a raw request so the Host header and path are exactly what a browser sends.
    private String request(String target, String host) throws Exception {
        try (Socket socket = new Socket("127.0.0.1", server.port())) {
            OutputStream out = socket.getOutputStream();
            out.write(("GET " + target + " HTTP/1.1\r\nHost: " + host + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.ISO_8859_1));
            out.flush();
            InputStream in = socket.getInputStream();
            ByteArrayOutputStream response = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int read;
            while ((read = in.read(buffer)) >= 0) response.write(buffer, 0, read);
            return response.toString("UTF-8");
        }
    }

    private String host() {
        return "127.0.0.1:" + server.port();
    }

    @Test
    public void redirectUriUsesLoopbackAndCallbackPath() {
        assertEquals("http://127.0.0.1:" + server.port() + "/auth/callback", server.redirectUri());
        assertTrue(server.port() > 0);
    }

    @Test
    public void deliversTheCallbackWithMatchingState() throws Exception {
        String response = request("/auth/callback?code=abc&state=good-state&client_id=oaiapp_1", host());
        assertTrue(response.startsWith("HTTP/1.1 200 OK"));
        assertTrue(response.contains("Return to Forehead Frenzy"));
        assertTrue(response.contains("intent://chatgpt-return#Intent;scheme=x;end"));
        assertTrue(latch.await(2, TimeUnit.SECONDS));
        assertEquals("http://127.0.0.1:" + server.port() + "/auth/callback?code=abc&state=good-state&client_id=oaiapp_1", delivered.get());
    }

    @Test
    public void ignoresRequestsThatDoNotMatchTheAttempt() throws Exception {
        assertTrue(request("/auth/callback?code=abc&state=forged", host()).startsWith("HTTP/1.1 400"));
        assertTrue(request("/favicon.ico", host()).startsWith("HTTP/1.1 404"));
        assertTrue(request("/auth/callback?code=abc&state=good-state", "localhost:" + server.port()).startsWith("HTTP/1.1 404"));
        assertTrue(request("/auth/callback?code=abc&state=good-state&state=good-state", host()).startsWith("HTTP/1.1 400"));
        assertNull(delivered.get());
        // The pending sign-in survives those and still completes.
        assertTrue(request("/auth/callback?code=abc&state=good-state", host()).startsWith("HTTP/1.1 200"));
        assertTrue(latch.await(2, TimeUnit.SECONDS));
    }

    @Test
    public void acceptsOnlyOneCallback() throws Exception {
        assertTrue(request("/auth/callback?code=abc&state=good-state", host()).startsWith("HTTP/1.1 200"));
        assertTrue(request("/auth/callback?code=again&state=good-state", host()).startsWith("HTTP/1.1 400"));
    }

    @Test
    public void decodesQueryParameters() {
        assertEquals("a b/c", ChatGptLoopbackServer.queryParam("x=1&state=a%20b%2Fc", "state"));
        assertNull(ChatGptLoopbackServer.queryParam("x=1", "state"));
        assertNull(ChatGptLoopbackServer.queryParam(null, "state"));
    }
}
