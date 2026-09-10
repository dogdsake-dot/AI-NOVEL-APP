import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.dogdsake.ainovelapp",
  appName: "AI Novel App",
  webDir: "../client/dist",
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
  }
};

export default config;
