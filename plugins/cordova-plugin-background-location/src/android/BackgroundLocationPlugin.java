package org.apache.cordova.backgroundlocation;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaPlugin;
import org.apache.cordova.PluginResult;
import org.json.JSONArray;
import org.json.JSONException;

public class BackgroundLocationPlugin extends CordovaPlugin {

    private static final String TAG = "BackgroundLocationPlugin";

    @Override
    public boolean execute(String action, JSONArray args, CallbackContext callbackContext) throws JSONException {
        Log.d(TAG, "Action: " + action);
        if ("startService".equals(action)) {
            startService(callbackContext);
            return true;
        } else if ("stopService".equals(action)) {
            stopService(callbackContext);
            return true;
        } else if ("getPendingLocations".equals(action)) {
            getPendingLocations(callbackContext);
            return true;
        }
        return false;
    }

    private void startService(final CallbackContext callbackContext) {
        cordova.getThreadPool().execute(new Runnable() {
            @Override
            public void run() {
                try {
                    Context context = cordova.getActivity().getApplicationContext();
                    Intent intent = new Intent(context, BackgroundLocationService.class);
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        context.startForegroundService(intent);
                        Log.d(TAG, "startForegroundService called");
                    } else {
                        context.startService(intent);
                        Log.d(TAG, "startService called");
                    }
                    callbackContext.success();
                } catch (Exception e) {
                    Log.e(TAG, "Error starting service", e);
                    callbackContext.error("Failed to start service: " + e.getMessage());
                }
            }
        });
    }

    private void stopService(final CallbackContext callbackContext) {
        cordova.getThreadPool().execute(new Runnable() {
            @Override
            public void run() {
                try {
                    Context context = cordova.getActivity().getApplicationContext();
                    Intent intent = new Intent(context, BackgroundLocationService.class);
                    context.stopService(intent);
                    Log.d(TAG, "stopService called");
                    callbackContext.success();
                } catch (Exception e) {
                    Log.e(TAG, "Error stopping service", e);
                    callbackContext.error("Failed to stop service: " + e.getMessage());
                }
            }
        });
    }

    private void getPendingLocations(CallbackContext callbackContext) {
        try {
            String json = BackgroundLocationService.getPendingLocationsJson(cordova.getActivity());
            PluginResult result = new PluginResult(PluginResult.Status.OK, json);
            callbackContext.sendPluginResult(result);
        } catch (Exception e) {
            Log.e(TAG, "Error getting pending locations", e);
            callbackContext.error("Failed to get locations: " + e.getMessage());
        }
    }
}
