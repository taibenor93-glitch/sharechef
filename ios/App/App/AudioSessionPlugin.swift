import Capacitor
import AVFoundation
import WebKit
import os

// Ends the microphone at the iOS level once a cook is over.
// The web code stops every mic track when a session ends, but WKWebView keeps
// its capture state and the audio session alive, so iOS keeps the orange mic
// dot lit (and the audio route stays in record mode). release() tells the web
// view its capture is over and hands the audio session back to the system.
// The next cook re-activates both on its own through getUserMedia.
@objc(AudioSessionPlugin)
public class AudioSessionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AudioSessionPlugin"
    public let jsName = "AudioSession"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "release", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "state", returnType: CAPPluginReturnPromise)
    ]

    // Read-only: what the web view's microphone capture is right now.
    @objc func state(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let webView = self.bridge?.webView else {
                call.reject("No web view.")
                return
            }
            call.resolve(["mic": AudioSessionPlugin.name(webView.microphoneCaptureState)])
        }
    }

    private let log = Logger(subsystem: "com.sharechef.app", category: "mic")

    private static func name(_ state: WKMediaCaptureState) -> String {
        switch state {
        case .none: return "none"
        case .active: return "active"
        case .muted: return "muted"
        @unknown default: return "unknown"
        }
    }

    @objc func release(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let webView = self.bridge?.webView else {
                call.reject("No web view.")
                return
            }
            let before = AudioSessionPlugin.name(webView.microphoneCaptureState)
            webView.setMicrophoneCaptureState(.none) {
                let after = AudioSessionPlugin.name(webView.microphoneCaptureState)
                var deactivated = true
                var sessionError = ""
                do {
                    try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
                } catch {
                    // Busy (e.g. something still playing): capture is already off,
                    // which is what clears the dot; report it and move on.
                    deactivated = false
                    sessionError = error.localizedDescription
                }
                self.log.notice("[ShareChef mic] release before=\(before, privacy: .public) after=\(after, privacy: .public) sessionOff=\(deactivated, privacy: .public) \(sessionError, privacy: .public)")
                call.resolve([
                    "before": before,
                    "after": after,
                    "sessionDeactivated": deactivated,
                    "sessionError": sessionError
                ])
            }
        }
    }
}
