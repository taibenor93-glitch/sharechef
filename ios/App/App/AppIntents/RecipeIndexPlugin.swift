import Capacitor
import Foundation

// Web app → iPhone: "these are the signed-in user's saved recipes"
// (see src/lib/recipeIndex.ts). Keeps RecipeStore and Spotlight in step so
// Siri can find a saved recipe.
//
// Before iOS 27.3 this does nothing and keeps nothing on the phone.
@objc(RecipeIndexPlugin)
public class RecipeIndexPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RecipeIndexPlugin"
    public let jsName = "RecipeIndex"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "sync", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise)
    ]

    // { json: "[{id,title,summary,ingredients,tags,cookTimeMinutes}]" } → { indexed: Int }
    // The list arrives as one JSON string so it is decoded and checked in one place.
    @objc func sync(_ call: CAPPluginCall) {
        guard #available(iOS 27.3, *) else {
            call.resolve(["indexed": 0])
            return
        }
        guard let json = call.getString("json"),
              let data = json.data(using: .utf8),
              let recipes = try? JSONDecoder().decode([StoredRecipe].self, from: data) else {
            call.reject("The recipe list could not be read.")
            return
        }
        Task {
            let count = await RecipeIndexer.replaceAll(recipes)
            call.resolve(["indexed": count])
        }
    }

    // Signed out: nothing about the last user stays on this phone.
    @objc func clear(_ call: CAPPluginCall) {
        guard #available(iOS 27.3, *) else {
            call.resolve(["indexed": 0])
            return
        }
        Task {
            _ = await RecipeIndexer.replaceAll([])
            call.resolve(["indexed": 0])
        }
    }
}
