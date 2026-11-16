import Capacitor
import Foundation

// Siri → app handoff (see src/lib/siri.ts).
//
// Siri runs one of the intents in MicheliSiriIntents.swift. The intent leaves
// its request in MicheliSiriInbox, and this plugin hands it to the web app.
//
// This is deliberately NOT a sharechef:// link: any web page or app can fire a
// link, and "start a cook" opens the microphone. A request can only get in
// here from Siri running our own intent.
extension Notification.Name {
    static let scSiriAction = Notification.Name("scSiriAction")
}

/// Holds the one request Siri made until the web app collects it.
final class MicheliSiriInbox {
    static let shared = MicheliSiriInbox()

    /// A request nobody collected within this window is dropped, so it can
    /// never fire later out of nowhere.
    private static let lifetime: TimeInterval = 60

    private let lock = NSLock()
    private var pending: (action: String, payload: String, at: Date)?

    private init() {}

    /// `payload` is the spoken ingredients for "make", or a recipe id for "recipe".
    func put(action: String, payload: String = "") {
        lock.lock()
        pending = (action, payload, Date())
        lock.unlock()
        DispatchQueue.main.async {
            NotificationCenter.default.post(name: .scSiriAction, object: nil)
        }
    }

    /// Returns the waiting request once, then forgets it.
    func take() -> (action: String, payload: String)? {
        lock.lock()
        defer { lock.unlock() }
        guard let request = pending else { return nil }
        pending = nil
        guard Date().timeIntervalSince(request.at) <= MicheliSiriInbox.lifetime else { return nil }
        return (request.action, request.payload)
    }
}

@objc(MicheliSiriPlugin)
public class MicheliSiriPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MicheliSiriPlugin"
    public let jsName = "MicheliSiri"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "takePending", returnType: CAPPluginReturnPromise)
    ]

    override public func load() {
        NotificationCenter.default.addObserver(self, selector: #selector(didReceiveRequest), name: .scSiriAction, object: nil)
    }

    // The app is already open: tell the web side there is something to collect.
    // It carries no data; the web side always asks through takePending.
    @objc private func didReceiveRequest() {
        notifyListeners("siriAction", data: [:])
    }

    // { action: "cook" } | { action: "make", ingredients: "chicken and rice" }
    // | { action: "recipe", recipeId: "<uuid>" } | {}
    @objc func takePending(_ call: CAPPluginCall) {
        guard let request = MicheliSiriInbox.shared.take() else {
            call.resolve([:])
            return
        }
        let key = request.action == "recipe" ? "recipeId" : "ingredients"
        call.resolve(["action": request.action, key: request.payload])
    }
}
