package org.apache.cordova.backgroundlocation;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

public class BackgroundLocationService extends Service {

    private static final String TAG = "BackgroundLocation";
    private static final String CHANNEL_ID = "fog_of_war_location";
    private static final int NOTIFICATION_ID = 1001;
    private static final String PREFS_NAME = "fogofwar_background";
    private static final String KEY_LOCATIONS = "pending_locations";
    private static final String WAKELOCK_TAG = "FogOfWar:LocationWakeLock";

    private LocationManager locationManager;
    private LocationListener locationListener;
    private PowerManager.WakeLock wakeLock;
    private final List<JSONObject> pendingLocations = new ArrayList<>();
    private int locationCount = 0;

    @Override
    public void onCreate() {
        super.onCreate();
        Log.d(TAG, "=== Service created ===");
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        createNotificationChannel();
        acquireWakeLock();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.d(TAG, "=== Service started (startId=" + startId + ") ===");
        startForeground(NOTIFICATION_ID, createNotification());
        startLocationUpdates();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        Log.d(TAG, "=== Service destroyed, collected " + locationCount + " locations ===");
        stopLocationUpdates();
        savePendingLocations();
        releaseWakeLock();
        super.onDestroy();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        Log.d(TAG, "=== Task removed ===");
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void acquireWakeLock() {
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKELOCK_TAG);
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire(10 * 60 * 60 * 1000L);
            Log.d(TAG, "WakeLock acquired");
        }
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
            Log.d(TAG, "WakeLock released");
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Туман Войны - GPS",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Отслеживание местоположения для открытия карты");
            channel.setShowBadge(false);
            channel.setLockscreenVisibility(Notification.VISIBILITY_SECRET);

            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
                Log.d(TAG, "Notification channel created");
            }
        }
    }

    private Notification createNotification() {
        Intent notificationIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (notificationIntent == null) notificationIntent = new Intent();
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this, 0, notificationIntent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Туман Войны")
            .setContentText("GPS: " + locationCount + " точек")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }

    private void updateNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(NOTIFICATION_ID, createNotification());
    }

    private void startLocationUpdates() {
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
            != PackageManager.PERMISSION_GRANTED) {
            Log.w(TAG, "Location permission not granted");
            return;
        }

        locationListener = new LocationListener() {
            @Override
            public void onLocationChanged(Location location) {
                locationCount++;
                Log.d(TAG, "Location #" + locationCount + ": " +
                    location.getLatitude() + ", " + location.getLongitude() +
                    " (accuracy=" + location.getAccuracy() + "m)");

                try {
                    JSONObject json = new JSONObject();
                    json.put("latitude", location.getLatitude());
                    json.put("longitude", location.getLongitude());
                    json.put("accuracy", location.hasAccuracy() ? location.getAccuracy() : 0);
                    json.put("altitude", location.hasAltitude() ? location.getAltitude() : 0);
                    json.put("speed", location.hasSpeed() ? location.getSpeed() : 0);
                    json.put("timestamp", location.getTime());
                    json.put("background", true);

                    synchronized (pendingLocations) {
                        pendingLocations.add(json);
                        if (pendingLocations.size() % 3 == 0) {
                            savePendingLocations();
                        }
                    }

                    if (locationCount % 5 == 0) updateNotification();
                } catch (JSONException e) {
                    Log.e(TAG, "JSON error", e);
                }
            }

            @Override public void onStatusChanged(String provider, int status, Bundle extras) {}
            @Override public void onProviderEnabled(String provider) {}
            @Override public void onProviderDisabled(String provider) {}
        };

        try {
            locationManager.requestLocationUpdates(
                LocationManager.GPS_PROVIDER, 1000, 0, locationListener, Looper.getMainLooper());
            locationManager.requestLocationUpdates(
                LocationManager.NETWORK_PROVIDER, 3000, 0, locationListener, Looper.getMainLooper());
            Log.d(TAG, "Location updates started (GPS + Network)");
        } catch (SecurityException e) {
            Log.e(TAG, "Security exception", e);
        }
    }

    private void stopLocationUpdates() {
        if (locationListener != null && locationManager != null) {
            try { locationManager.removeUpdates(locationListener); }
            catch (SecurityException e) { Log.e(TAG, "Security exception", e); }
        }
    }

    private void savePendingLocations() {
        synchronized (pendingLocations) {
            if (pendingLocations.isEmpty()) return;
            try {
                SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
                String existing = prefs.getString(KEY_LOCATIONS, "[]");
                JSONArray existingArray = new JSONArray(existing);
                for (JSONObject loc : pendingLocations) existingArray.put(loc);
                prefs.edit().putString(KEY_LOCATIONS, existingArray.toString()).apply();
                Log.d(TAG, "Saved " + pendingLocations.size() + " locations, total: " + existingArray.length());
                pendingLocations.clear();
            } catch (JSONException e) {
                Log.e(TAG, "Error saving locations", e);
            }
        }
    }

    public static String getPendingLocationsJson(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String json = prefs.getString(KEY_LOCATIONS, "[]");
        prefs.edit().remove(KEY_LOCATIONS).apply();
        Log.d(TAG, "Returning " + json + " pending locations");
        return json;
    }
}
