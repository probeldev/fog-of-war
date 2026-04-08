package org.apache.cordova.nativelocation;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Looper;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaPlugin;
import org.apache.cordova.PluginResult;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.HashMap;
import java.util.Map;

public class NativeLocation extends CordovaPlugin {

    private static final String TAG = "NativeLocation";
    private static final int PERMISSIONS_REQUEST_CODE = 100;

    private LocationManager locationManager;
    private final Map<String, LocationListener> listeners = new HashMap<>();

    private static final String[] PERMISSIONS = {
        Manifest.permission.ACCESS_COARSE_LOCATION,
        Manifest.permission.ACCESS_FINE_LOCATION
    };

    private int pendingAction = 0;
    private CallbackContext pendingCallback;
    private JSONArray pendingArgs;

    private static final int ACTION_GET_LOCATION = 1;
    private static final int ACTION_ADD_WATCH = 2;
    private static final int ACTION_GET_PERMISSION = 3;

    @Override
    protected void pluginInitialize() {
        super.pluginInitialize();
        locationManager = (LocationManager) cordova.getActivity().getSystemService(Context.LOCATION_SERVICE);
    }

    @Override
    public boolean execute(String action, JSONArray args, CallbackContext callbackContext) throws JSONException {
        if ("getPermission".equals(action)) {
            pendingAction = ACTION_GET_PERMISSION;
            pendingCallback = callbackContext;
            pendingArgs = args;
            ensurePermission();
            return true;
        } else if ("getLocation".equals(action)) {
            pendingAction = ACTION_GET_LOCATION;
            pendingCallback = callbackContext;
            pendingArgs = args;
            ensurePermission();
            return true;
        } else if ("addWatch".equals(action)) {
            pendingAction = ACTION_ADD_WATCH;
            pendingCallback = callbackContext;
            pendingArgs = args;
            ensurePermission();
            return true;
        } else if ("clearWatch".equals(action)) {
            clearWatch(args.getString(0));
            callbackContext.success();
            return true;
        }
        return false;
    }

    private void ensurePermission() {
        if (hasPermissions()) {
            executePending();
        } else {
            Activity activity = cordova.getActivity();
            ActivityCompat.requestPermissions(activity, PERMISSIONS, PERMISSIONS_REQUEST_CODE);
        }
    }

    private void executePending() {
        try {
            switch (pendingAction) {
                case ACTION_GET_PERMISSION:
                    pendingCallback.success(Build.VERSION.SDK_INT);
                    break;
                case ACTION_GET_LOCATION:
                    doGetLocation(pendingArgs.optBoolean(0), pendingArgs.optLong(1, 0), pendingCallback);
                    break;
                case ACTION_ADD_WATCH:
                    doAddWatch(pendingArgs.getString(0), pendingArgs.optBoolean(1), pendingCallback);
                    break;
            }
        } catch (JSONException e) {
            if (pendingCallback != null) {
                pendingCallback.error("JSON error: " + e.getMessage());
            }
        } finally {
            pendingAction = 0;
            pendingCallback = null;
            pendingArgs = null;
        }
    }

    private void doGetLocation(boolean highAccuracy, long maximumAge, CallbackContext callbackContext) {
        try {
            Location lastKnown = locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER);
            if (lastKnown != null && maximumAge > 0) {
                long age = System.currentTimeMillis() - lastKnown.getTime();
                if (age <= maximumAge) {
                    callbackContext.success(locationToJson(lastKnown));
                    return;
                }
            }

            final CallbackContext ctx = callbackContext;
            LocationListener listener = new LocationListener() {
                @Override
                public void onLocationChanged(Location location) {
                    try {
                        ctx.success(locationToJson(location));
                    } catch (JSONException e) {
                        ctx.error("JSON error: " + e.getMessage());
                    }
                    locationManager.removeUpdates(this);
                }

                @Override
                public void onStatusChanged(String provider, int status, Bundle extras) {}

                @Override
                public void onProviderEnabled(String provider) {}

                @Override
                public void onProviderDisabled(String provider) {
                    ctx.error("Location provider disabled");
                }
            };

            String provider = highAccuracy ? LocationManager.GPS_PROVIDER : LocationManager.NETWORK_PROVIDER;
            locationManager.requestSingleUpdate(provider, listener, Looper.getMainLooper());
        } catch (SecurityException e) {
            callbackContext.error("Security exception: " + e.getMessage());
        } catch (JSONException e) {
            callbackContext.error("JSON error: " + e.getMessage());
        }
    }

    private void doAddWatch(String id, boolean highAccuracy, CallbackContext callbackContext) {
        try {
            final CallbackContext ctx = callbackContext;
            LocationListener listener = new LocationListener() {
                @Override
                public void onLocationChanged(Location location) {
                    try {
                        PluginResult result = new PluginResult(PluginResult.Status.OK, locationToJson(location));
                        result.setKeepCallback(true);
                        ctx.sendPluginResult(result);
                    } catch (JSONException e) {
                        PluginResult result = new PluginResult(PluginResult.Status.ERROR, "JSON error");
                        result.setKeepCallback(true);
                        ctx.sendPluginResult(result);
                    }
                }

                @Override
                public void onStatusChanged(String provider, int status, Bundle extras) {}

                @Override
                public void onProviderEnabled(String provider) {}

                @Override
                public void onProviderDisabled(String provider) {
                    PluginResult result = new PluginResult(PluginResult.Status.ERROR, "Location provider disabled");
                    result.setKeepCallback(true);
                    ctx.sendPluginResult(result);
                }
            };

            listeners.put(id, listener);

            String provider = highAccuracy ? LocationManager.GPS_PROVIDER : LocationManager.NETWORK_PROVIDER;
            locationManager.requestLocationUpdates(provider, 1000, 0, listener, Looper.getMainLooper());

            Location lastKnown = locationManager.getLastKnownLocation(provider);
            if (lastKnown != null) {
                PluginResult result = new PluginResult(PluginResult.Status.OK, locationToJson(lastKnown));
                result.setKeepCallback(true);
                ctx.sendPluginResult(result);
            }

            callbackContext.success();
        } catch (SecurityException e) {
            callbackContext.error("Security exception: " + e.getMessage());
        } catch (JSONException e) {
            callbackContext.error("JSON error: " + e.getMessage());
        }
    }

    private void clearWatch(String id) {
        LocationListener listener = listeners.remove(id);
        if (listener != null) {
            try {
                locationManager.removeUpdates(listener);
            } catch (SecurityException e) {
                // ignore
            }
        }
    }

    private boolean hasPermissions() {
        for (String p : PERMISSIONS) {
            if (ContextCompat.checkSelfPermission(cordova.getActivity(), p) != PackageManager.PERMISSION_GRANTED) {
                return false;
            }
        }
        return true;
    }

    @Override
    public void onRequestPermissionResult(int requestCode, String[] permissions, int[] grantResults) throws JSONException {
        if (requestCode == PERMISSIONS_REQUEST_CODE) {
            boolean allGranted = true;
            for (int result : grantResults) {
                if (result != PackageManager.PERMISSION_GRANTED) {
                    allGranted = false;
                    break;
                }
            }

            if (pendingCallback != null) {
                if (allGranted) {
                    if (pendingAction == ACTION_GET_PERMISSION) {
                        pendingCallback.success(Build.VERSION.SDK_INT);
                    } else {
                        executePending();
                    }
                } else {
                    pendingCallback.error("Permission denied by user");
                }
            }

            pendingAction = 0;
            pendingCallback = null;
            pendingArgs = null;
        }
    }

    private JSONObject locationToJson(Location location) throws JSONException {
        JSONObject obj = new JSONObject();
        obj.put("latitude", location.getLatitude());
        obj.put("longitude", location.getLongitude());
        obj.put("altitude", location.hasAltitude() ? location.getAltitude() : 0);
        obj.put("accuracy", location.hasAccuracy() ? location.getAccuracy() : 0);
        obj.put("altitudeAccuracy", 0);
        obj.put("heading", location.hasBearing() ? location.getBearing() : 0);
        obj.put("velocity", location.hasSpeed() ? location.getSpeed() : 0);
        obj.put("timestamp", location.getTime());
        return obj;
    }
}
