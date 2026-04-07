/*
 * Native Location Plugin - JavaScript Interface
 * Uses native Android LocationManager for reliable GPS
 * Loaded as regular script tag, not Cordova plugin module
 */

(function() {
    'use strict';

    const timers = {};

    function parseParameters(options) {
        const opt = {
            maximumAge: 0,
            enableHighAccuracy: false,
            timeout: Infinity
        };

        if (options) {
            if (options.maximumAge !== undefined && !isNaN(options.maximumAge) && options.maximumAge > 0) {
                opt.maximumAge = options.maximumAge;
            }
            if (options.enableHighAccuracy !== undefined) {
                opt.enableHighAccuracy = options.enableHighAccuracy;
            }
            if (options.timeout !== undefined && !isNaN(options.timeout)) {
                if (options.timeout < 0) {
                    opt.timeout = 0;
                } else {
                    opt.timeout = options.timeout;
                }
            }
        }

        return opt;
    }

    function createTimeout(errorCallback, timeout) {
        let t = setTimeout(function () {
            clearTimeout(t);
            t = null;
            errorCallback({
                code: 3, // TIMEOUT
                message: 'Position retrieval timed out.'
            });
        }, timeout);
        return t;
    }

    function PositionError(code, message) {
        this.code = code;
        this.message = message;
    }
    PositionError.PERMISSION_DENIED = 1;
    PositionError.POSITION_UNAVAILABLE = 2;
    PositionError.TIMEOUT = 3;

    function Position(coords, timestamp) {
        this.coords = {
            latitude: coords.latitude,
            longitude: coords.longitude,
            altitude: coords.altitude,
            accuracy: coords.accuracy,
            altitudeAccuracy: coords.altitudeAccuracy,
            heading: coords.heading,
            velocity: coords.velocity
        };
        this.timestamp = timestamp;
    }

    function exec(success, fail, service, action, args) {
        if (window.cordova && cordova.exec) {
            cordova.exec(success, fail, service, action, args || []);
        } else {
            console.error('cordova.exec not available');
            if (fail) fail({ code: 2, message: 'cordova.exec not available' });
        }
    }

    const nativeLocation = {
        lastPosition: null,

        getCurrentPosition: function (successCallback, errorCallback, options) {
            options = parseParameters(options);

            const timeoutTimer = { timer: null };

            const win = function (p) {
                clearTimeout(timeoutTimer.timer);
                if (!timeoutTimer.timer) {
                    return;
                }
                const pos = new Position(
                    {
                        latitude: p.latitude,
                        longitude: p.longitude,
                        altitude: p.altitude,
                        accuracy: p.accuracy,
                        heading: p.heading,
                        velocity: p.velocity,
                        altitudeAccuracy: p.altitudeAccuracy
                    },
                    p.timestamp
                );
                nativeLocation.lastPosition = pos;
                successCallback(pos);
            };

            const fail = function (e) {
                clearTimeout(timeoutTimer.timer);
                timeoutTimer.timer = null;
                const err = new PositionError(e.code || PositionError.POSITION_UNAVAILABLE, e.message || 'Position unavailable');
                if (errorCallback) {
                    errorCallback(err);
                }
            };

            if (nativeLocation.lastPosition && options.maximumAge &&
                new Date().getTime() - nativeLocation.lastPosition.timestamp <= options.maximumAge) {
                successCallback(nativeLocation.lastPosition);
            } else if (options.timeout === 0) {
                fail({ code: PositionError.TIMEOUT, message: 'timeout set to 0' });
            } else {
                if (options.timeout !== Infinity) {
                    timeoutTimer.timer = createTimeout(fail, options.timeout);
                } else {
                    timeoutTimer.timer = true;
                }
                exec(win, fail, 'NativeLocation', 'getLocation', [options.enableHighAccuracy, options.maximumAge]);
            }
            return timeoutTimer;
        },

        watchPosition: function (successCallback, errorCallback, options) {
            options = parseParameters(options);

            const id = 'watch_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

            timers[id] = nativeLocation.getCurrentPosition(successCallback, errorCallback, options);

            const fail = function (e) {
                if (timers[id] && timers[id].timer) {
                    clearTimeout(timers[id].timer);
                }
                const err = new PositionError(e.code || PositionError.POSITION_UNAVAILABLE, e.message || 'Position unavailable');
                if (errorCallback) {
                    errorCallback(err);
                }
            };

            const win = function (p) {
                if (options.timeout !== Infinity) {
                    timers[id].timer = createTimeout(fail, options.timeout);
                }
                const pos = new Position(
                    {
                        latitude: p.latitude,
                        longitude: p.longitude,
                        altitude: p.altitude,
                        accuracy: p.accuracy,
                        heading: p.heading,
                        velocity: p.velocity,
                        altitudeAccuracy: p.altitudeAccuracy
                    },
                    p.timestamp
                );
                nativeLocation.lastPosition = pos;
                successCallback(pos);
            };

            exec(win, fail, 'NativeLocation', 'addWatch', [id, options.enableHighAccuracy]);

            return id;
        },

        clearWatch: function (id) {
            if (id && timers[id] !== undefined) {
                clearTimeout(timers[id].timer);
                timers[id].timer = false;
                exec(null, null, 'NativeLocation', 'clearWatch', [id]);
            }
        },

        getPermission: function (successCallback, errorCallback) {
            exec(successCallback, errorCallback, 'NativeLocation', 'getPermission', [true]);
        }
    };

    // Expose globally
    if (!navigator.nativeLocation) {
        navigator.nativeLocation = nativeLocation;
    }

})();
