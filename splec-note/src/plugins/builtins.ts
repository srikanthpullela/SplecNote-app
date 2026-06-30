// Built-in (first-party) plugin registry. The app loads plugins from this
// folder. To add a plugin, drop a module in ./samples and append it here.
// See PLUGINS.md for the host API and security model.

import type { PluginModule } from "./api";
import { wordCountPlugin } from "./samples/wordcount";
import { jsonToolsPlugin } from "./samples/jsontools";

export const builtinPlugins: PluginModule[] = [wordCountPlugin, jsonToolsPlugin];
