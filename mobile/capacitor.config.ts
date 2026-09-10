import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.dogdsake.ainovelapp",
  appName: "AI Novel App",
  webDir: "../client/dist",
  server: {
    androidScheme: "https",
    cleartext: true
  },
  android: {
    allowMixedContent: true
  }
};

export default config;
