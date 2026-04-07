/*
 * Background Location Service
 * Starts a foreground Android service that collects GPS even when screen is locked
 */
(function() {
    'use strict';

    var backgroundLocation = {
        /**
         * Start the background location service
         */
        start: function(successCallback, errorCallback) {
            if (window.cordova && cordova.exec) {
                cordova.exec(
                    successCallback || function() {},
                    errorCallback || function() {},
                    'BackgroundLocation',
                    'startService',
                    []
                );
            }
        },

        /**
         * Stop the background location service
         */
        stop: function(successCallback, errorCallback) {
            if (window.cordova && cordova.exec) {
                cordova.exec(
                    successCallback || function() {},
                    errorCallback || function() {},
                    'BackgroundLocation',
                    'stopService',
                    []
                );
            }
        },

        /**
         * Get pending locations collected by the background service
         * Returns JSON array of location objects
         */
        getPendingLocations: function(successCallback, errorCallback) {
            if (window.cordova && cordova.exec) {
                cordova.exec(
                    function(jsonString) {
                        try {
                            var locations = JSON.parse(jsonString);
                            if (successCallback) successCallback(locations);
                        } catch (e) {
                            if (errorCallback) errorCallback(e);
                        }
                    },
                    errorCallback || function() {},
                    'BackgroundLocation',
                    'getPendingLocations',
                    []
                );
            }
        }
    };

    // Expose globally
    if (!window.backgroundLocation) {
        window.backgroundLocation = backgroundLocation;
    }
})();
