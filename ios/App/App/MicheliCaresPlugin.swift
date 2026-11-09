import Capacitor
import UIKit
import UserNotifications

// Micheli Cares (see src/lib/micheliCares.ts).
// On the PARENT's phone: asks iOS for permission to show notifications, then
// gets this phone's push address from Apple so the server can send check-ins.
// AppDelegate forwards Apple's answer here through NotificationCenter.
extension Notification.Name {
    static let scPushRegistered = Notification.Name("scPushRegistered")
    static let scPushFailed = Notification.Name("scPushFailed")
}

@objc(MicheliCaresPlugin)
public class MicheliCaresPlugin: CAPPlugin, CAPBridgedPlugin, UNUserNotificationCenterDelegate {
    public let identifier = "MicheliCaresPlugin"
    public let jsName = "MicheliCares"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "register", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise)
    ]

    private var pendingCall: CAPPluginCall?

    override public func load() {
        // Show check-ins even while ShareChef is open on the parent's phone.
        UNUserNotificationCenter.current().delegate = self
        NotificationCenter.default.addObserver(self, selector: #selector(didRegister(_:)), name: .scPushRegistered, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(didFail(_:)), name: .scPushFailed, object: nil)
    }

    // { permission: "granted" | "denied" | "notDetermined" }
    @objc func status(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            let value: String
            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral: value = "granted"
            case .denied: value = "denied"
            default: value = "notDetermined"
            }
            call.resolve(["permission": value])
        }
    }

    // { granted: Bool, token?: String }
    @objc func register(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
            if let error = error {
                call.reject(error.localizedDescription)
                return
            }
            guard granted else {
                call.resolve(["granted": false])
                return
            }
            DispatchQueue.main.async {
                if let previous = self.pendingCall {
                    previous.reject("Replaced by a newer request.")
                }
                self.pendingCall = call
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
    }

    @objc private func didRegister(_ note: Notification) {
        guard let data = note.object as? Data else { return }
        let token = data.map { String(format: "%02x", $0) }.joined()
        DispatchQueue.main.async {
            self.pendingCall?.resolve(["granted": true, "token": token])
            self.pendingCall = nil
        }
    }

    @objc private func didFail(_ note: Notification) {
        let message = (note.object as? Error)?.localizedDescription ?? "Could not register for notifications."
        DispatchQueue.main.async {
            self.pendingCall?.reject(message)
            self.pendingCall = nil
        }
    }

    public func userNotificationCenter(_ center: UNUserNotificationCenter,
                                       willPresent notification: UNNotification,
                                       withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list, .sound])
    }
}
