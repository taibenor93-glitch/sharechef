import UIKit
import Capacitor

// Registers app-local Capacitor plugins (ScreenRecorderPlugin, MicheliCaresPlugin, AppReviewPlugin).
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(ScreenRecorderPlugin())
        bridge?.registerPluginInstance(MicheliCaresPlugin())
        bridge?.registerPluginInstance(AppReviewPlugin())
    }
}
