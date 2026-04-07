{pkgs ? import <nixpkgs> {
  config = {
    android_sdk.accept_license = true;
    allowUnfree = true;
    allowUnsupportedSystem = true;
  };
}, ...}: let
  androidComposition = pkgs.androidenv.composeAndroidPackages {
    toolsVersion = "26.1.1";
    platformToolsVersion = "35.0.1";
    buildToolsVersions = [ "35.0.0" ];

    includeEmulator = true;
    emulatorVersion = "35.6.9";

    includeSystemImages = true;
    platformVersions = ["27" "34" "35"];
    abiVersions = ["x86_64"];
    systemImageTypes = ["default"];

    includeSources = false; 
    includeNDK = false;
    useGoogleAPIs = false;

    extraLicenses = [];
  };
  androidSdk = androidComposition.androidsdk;
in
pkgs.mkShell {
  buildInputs = with pkgs; [
    androidSdk
    openjdk
    gradle
	nodejs_24
	cordova
    
    # Android Studio только для поддерживаемых систем
  ] ++ (if pkgs.stdenv.isLinux then [android-studio] else []);
  
  shellHook = ''
    export ANDROID_HOME="${androidSdk}/libexec/android-sdk"
    export ANDROID_SDK_ROOT="$ANDROID_HOME"
    export ANDROID_USER_HOME="$HOME/.android"
    export ANDROID_AVD_HOME="$HOME/.android/avd"

    # На Darwin (macOS) используем родную платформу
    if [ "$(uname)" = "Darwin" ]; then
      export QT_QPA_PLATFORM="cocoa"
    else
      export QT_QPA_PLATFORM="xcb"
    fi
    
    export LD_LIBRARY_PATH="${pkgs.libglvnd}/lib":$LD_LIBRARY_PATH
  '';
}
