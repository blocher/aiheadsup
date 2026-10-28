package com.benjaminlocher.foreheadfrenzy;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local App-module plugins are not auto-registered like npm plugins.
        registerPlugin(SecureAiPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
