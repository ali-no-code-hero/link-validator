import { createRequire } from "node:module";
import { join } from "node:path";
import type { PluginList } from "playwright-extra";

/**
 * Stealth lists evasions as `stealth/evasions/*` and resolves them via dynamic require.
 * Vercel's serverless trace often omits those subpaths; pre-register the real modules.
 *
 * @see https://github.com/berstend/puppeteer-extra/tree/master/packages/playwright-extra#plugins
 */
export function registerStealthEvasionResolutions(plugins: PluginList): void {
  const require = createRequire(join(process.cwd(), "package.json"));
  const reg = (suffix: string) => {
    const virtualPath = `stealth/evasions/${suffix}`;
    const pkgPath = `puppeteer-extra-plugin-stealth/evasions/${suffix}`;
    plugins.setDependencyResolution(virtualPath, require(pkgPath));
  };

  reg("chrome.app");
  reg("chrome.csi");
  reg("chrome.loadTimes");
  reg("chrome.runtime");
  reg("defaultArgs");
  reg("iframe.contentWindow");
  reg("media.codecs");
  reg("navigator.hardwareConcurrency");
  reg("navigator.languages");
  reg("navigator.permissions");
  reg("navigator.plugins");
  reg("navigator.webdriver");
  reg("sourceurl");
  reg("user-agent-override");
  reg("webgl.vendor");
  reg("window.outerdimensions");
}
