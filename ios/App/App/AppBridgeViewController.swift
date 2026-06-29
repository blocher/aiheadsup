import Capacitor
import UIKit

/// Registers in-app Capacitor plugins. Required since Capacitor 6 — npm plugins
/// auto-register via packageClassList, but local App-target plugins do not.
class AppBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(AiSecurePlugin())
    }
}
