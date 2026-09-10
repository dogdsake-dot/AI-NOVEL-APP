import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const write = (p, content) => fs.writeFileSync(path.join(root, p), content, "utf8");

function replaceOnce(file, before, after, label) {
  let text = read(file);
  if (text.includes(after)) return;
  if (!text.includes(before)) {
    throw new Error(`DeepSeek mobile patch failed (${label}) in ${file}; upstream changed.`);
  }
  text = text.replace(before, after);
  write(file, text);
}

// Mobile Settings: expose only the DeepSeek provider returned by the original server.
replaceOnce(
  "client/src/pages/settings/SettingsPage.tsx",
  "  const providerConfigs = useMemo(() => apiKeySettingsQuery.data?.data ?? [], [apiKeySettingsQuery.data?.data]);",
  `  const isMobileDeepSeekOnly = import.meta.env.VITE_MOBILE_BUILD === "true";\n  const providerConfigs = useMemo(() => {\n    const providers = apiKeySettingsQuery.data?.data ?? [];\n    return isMobileDeepSeekOnly ? providers.filter((item) => item.provider === "deepseek") : providers;\n  }, [apiKeySettingsQuery.data?.data, isMobileDeepSeekOnly]);`,
  "settings provider filter",
);

// Mobile Settings: always show the DeepSeek card, even before the first API key is configured.
replaceOnce(
  "client/src/pages/settings/components/ProviderSettingsSection.tsx",
  "  const [isAddProviderOpen, setIsAddProviderOpen] = useState(false);",
  `  const [isAddProviderOpen, setIsAddProviderOpen] = useState(false);\n  const isMobileDeepSeekOnly = import.meta.env.VITE_MOBILE_BUILD === "true";`,
  "provider section mobile flag",
);
replaceOnce(
  "client/src/pages/settings/components/ProviderSettingsSection.tsx",
  `  const visibleViewModels = useMemo(\n    () => viewModels.filter(({ provider }) => provider.isConfigured && provider.isActive),\n    [viewModels],\n  );`,
  `  const visibleViewModels = useMemo(\n    () => isMobileDeepSeekOnly\n      ? viewModels.filter(({ provider }) => provider.provider === "deepseek")\n      : viewModels.filter(({ provider }) => provider.isConfigured && provider.isActive),\n    [isMobileDeepSeekOnly, viewModels],\n  );\n  const availableConnectionCount = useMemo(\n    () => viewModels.filter(({ provider }) => provider.isConfigured && provider.isActive).length,\n    [viewModels],\n  );`,
  "provider card visibility",
);
replaceOnce(
  "client/src/pages/settings/components/ProviderSettingsSection.tsx",
  `<CardTitle>模型厂商</CardTitle>\n              <Badge variant={visibleViewModels.length ? "default" : "outline"}>{visibleViewModels.length} 个可用连接</Badge>`,
  `<CardTitle>{isMobileDeepSeekOnly ? "DeepSeek 模型" : "模型厂商"}</CardTitle>\n              <Badge variant={availableConnectionCount ? "default" : "outline"}>{availableConnectionCount} 个可用连接</Badge>`,
  "provider section title",
);
replaceOnce(
  "client/src/pages/settings/components/ProviderSettingsSection.tsx",
  `        <div className="flex flex-wrap gap-2">\n          <Button className={AUTO_DIRECTOR_MOBILE_CLASSES.fullWidthAction} onClick={() => setIsAddProviderOpen(true)}>\n            <Plus className="h-4 w-4" /> 添加厂商\n          </Button>\n        </div>`,
  `        {!isMobileDeepSeekOnly ? (\n          <div className="flex flex-wrap gap-2">\n            <Button className={AUTO_DIRECTOR_MOBILE_CLASSES.fullWidthAction} onClick={() => setIsAddProviderOpen(true)}>\n              <Plus className="h-4 w-4" /> 添加厂商\n            </Button>\n          </div>\n        ) : null}`,
  "hide mobile add-provider entry",
);

// Every model selector in the packaged app is constrained to the runnable DeepSeek connection.
replaceOnce(
  "client/src/components/common/LLMSelector.tsx",
  `  const providerConfigs = useMemo(\n    () => (apiKeySettingsQuery.data?.data ?? []).filter(isRunnableProviderConfig),\n    [apiKeySettingsQuery.data?.data],\n  );`,
  `  const isMobileDeepSeekOnly = import.meta.env.VITE_MOBILE_BUILD === "true";\n  const providerConfigs = useMemo(\n    () => (apiKeySettingsQuery.data?.data ?? []).filter((item) =>\n      isRunnableProviderConfig(item) && (!isMobileDeepSeekOnly || item.provider === "deepseek"),\n    ),\n    [apiKeySettingsQuery.data?.data, isMobileDeepSeekOnly],\n  );`,
  "global model selector filter",
);

// Global selection bootstrap must not re-hydrate an old non-DeepSeek provider on Android.
replaceOnce(
  "client/src/components/layout/LLMSelectionBootstrap.tsx",
  `  const resolvedSelection = useMemo(() => {`,
  `  const isMobileDeepSeekOnly = import.meta.env.VITE_MOBILE_BUILD === "true";\n  const mobileProviderConfigs = useMemo(() => {\n    const providers = apiKeySettingsQuery.data?.data ?? [];\n    return isMobileDeepSeekOnly ? providers.filter((item) => item.provider === "deepseek") : providers;\n  }, [apiKeySettingsQuery.data?.data, isMobileDeepSeekOnly]);\n\n  const resolvedSelection = useMemo(() => {`,
  "selection bootstrap provider list",
);
replaceOnce(
  "client/src/components/layout/LLMSelectionBootstrap.tsx",
  `    if (savedSelection && apiKeySettingsQuery.isError) {\n      return savedSelection;\n    }\n    return resolvePreferredLLMSelection(\n      savedSelection,\n      apiKeySettingsQuery.data?.data ?? [],`,
  `    if (savedSelection && apiKeySettingsQuery.isError) {\n      return isMobileDeepSeekOnly && savedSelection.provider !== "deepseek" ? null : savedSelection;\n    }\n    return resolvePreferredLLMSelection(\n      savedSelection,\n      mobileProviderConfigs,`,
  "selection bootstrap resolution",
);
replaceOnce(
  "client/src/components/layout/LLMSelectionBootstrap.tsx",
  `    apiKeySettingsQuery.data?.data,\n    apiKeySettingsQuery.isError,`,
  `    apiKeySettingsQuery.data?.data,\n    apiKeySettingsQuery.isError,\n    isMobileDeepSeekOnly,\n    mobileProviderConfigs,`,
  "selection bootstrap dependencies",
);

// Quick setup: Android has one simple DeepSeek path instead of a vendor chooser.
replaceOnce(
  "client/src/components/onboarding/QuickSetupDialog.tsx",
  `  const [showAllProviderChoices, setShowAllProviderChoices] = useState(false);`,
  `  const [showAllProviderChoices, setShowAllProviderChoices] = useState(false);\n  const isMobileDeepSeekOnly = import.meta.env.VITE_MOBILE_BUILD === "true";\n  const availableProviders = useMemo(() => {\n    const providers = props.status?.providers ?? [];\n    return isMobileDeepSeekOnly ? providers.filter((provider) => provider.id === "deepseek") : providers;\n  }, [isMobileDeepSeekOnly, props.status?.providers]);`,
  "quick setup mobile provider list",
);
replaceOnce(
  "client/src/components/onboarding/QuickSetupDialog.tsx",
  `    () => props.status?.providers.find((provider) => provider.id === form.provider) ?? null,\n    [form.provider, props.status?.providers],`,
  `    () => availableProviders.find((provider) => provider.id === form.provider) ?? null,\n    [availableProviders, form.provider],`,
  "quick setup selected provider",
);
replaceOnce(
  "client/src/components/onboarding/QuickSetupDialog.tsx",
  `    () => props.status?.providers.find((provider) => provider.id === props.status?.selectedProvider)\n      ?? props.status?.providers.find((provider) => provider.id === "deepseek")\n      ?? props.status?.providers[0]\n      ?? null,\n    [props.status?.providers, props.status?.selectedProvider],`,
  `    () => availableProviders.find((provider) => provider.id === (isMobileDeepSeekOnly ? "deepseek" : props.status?.selectedProvider))\n      ?? availableProviders.find((provider) => provider.id === "deepseek")\n      ?? availableProviders[0]\n      ?? null,\n    [availableProviders, isMobileDeepSeekOnly, props.status?.selectedProvider],`,
  "quick setup recommended provider",
);
replaceOnce(
  "client/src/components/onboarding/QuickSetupDialog.tsx",
  `  const providerChoices: QuickSetupProviderOption[] = showAllProviderChoices\n    ? props.status?.providers ?? []\n    : preferredProvider ? [preferredProvider] : [];`,
  `  const providerChoices: QuickSetupProviderOption[] = showAllProviderChoices\n    ? availableProviders\n    : preferredProvider ? [preferredProvider] : [];`,
  "quick setup provider choices",
);
replaceOnce(
  "client/src/components/onboarding/QuickSetupDialog.tsx",
  `    const preferred = props.status.providers.find(\n      (provider) => provider.id === props.status?.selectedProvider,\n    ) ?? props.status.providers.find((provider) => provider.id === "deepseek")\n      ?? props.status.providers[0];`,
  `    const preferred = availableProviders.find(\n      (provider) => provider.id === (isMobileDeepSeekOnly ? "deepseek" : props.status?.selectedProvider),\n    ) ?? availableProviders.find((provider) => provider.id === "deepseek")\n      ?? availableProviders[0];`,
  "quick setup initialization",
);
replaceOnce(
  "client/src/components/onboarding/QuickSetupDialog.tsx",
  `  }, [form.provider, form.providerKind, props.open, props.status]);`,
  `  }, [availableProviders, form.provider, form.providerKind, isMobileDeepSeekOnly, props.open, props.status]);`,
  "quick setup init dependencies",
);
replaceOnce(
  "client/src/components/onboarding/QuickSetupDialog.tsx",
  `              {!showAllProviderChoices ? (`,
  `              {!isMobileDeepSeekOnly && !showAllProviderChoices ? (`,
  "hide mobile all-provider button",
);
replaceOnce(
  "client/src/components/onboarding/QuickSetupDialog.tsx",
  `              <button\n                type="button"\n                className={cn(\n                  "rounded-xl border border-dashed p-4 text-left transition hover:border-primary/50 hover:bg-primary/5",\n                  form.providerKind === "custom" && !form.provider && "border-primary bg-primary/5 ring-1 ring-primary/20",\n                )}\n                onClick={() => chooseCustom(true)}\n              >\n                <div className="flex items-center gap-2 font-semibold"><ServerCog className="h-4 w-4" /> 添加第三方厂商 <ArrowRight className="h-4 w-4" /></div>\n                <div className="mt-2 text-xs leading-5 text-muted-foreground">新增一份独立的厂商配置，适合中转服务、本地网关或 OpenAI 兼容接口。</div>\n              </button>`,
  `              {!isMobileDeepSeekOnly ? (\n                <button\n                  type="button"\n                  className={cn(\n                    "rounded-xl border border-dashed p-4 text-left transition hover:border-primary/50 hover:bg-primary/5",\n                    form.providerKind === "custom" && !form.provider && "border-primary bg-primary/5 ring-1 ring-primary/20",\n                  )}\n                  onClick={() => chooseCustom(true)}\n                >\n                  <div className="flex items-center gap-2 font-semibold"><ServerCog className="h-4 w-4" /> 添加第三方厂商 <ArrowRight className="h-4 w-4" /></div>\n                  <div className="mt-2 text-xs leading-5 text-muted-foreground">新增一份独立的厂商配置，适合中转服务、本地网关或 OpenAI 兼容接口。</div>\n                </button>\n              ) : null}`,
  "hide mobile custom provider button",
);

// Advanced model routing: provider pickers on Android only offer DeepSeek.
replaceOnce(
  "client/src/pages/settings/ModelRoutesPage.tsx",
  `  const providerConfigs = useMemo(() => apiKeySettingsQuery.data?.data ?? [], [apiKeySettingsQuery.data?.data]);`,
  `  const isMobileDeepSeekOnly = import.meta.env.VITE_MOBILE_BUILD === "true";\n  const providerConfigs = useMemo(() => {\n    const providers = apiKeySettingsQuery.data?.data ?? [];\n    return isMobileDeepSeekOnly ? providers.filter((item) => item.provider === "deepseek") : providers;\n  }, [apiKeySettingsQuery.data?.data, isMobileDeepSeekOnly]);`,
  "model routes provider filter",
);
replaceOnce(
  "client/src/pages/settings/ModelRoutesPage.tsx",
  `      model: structuredFallback?.model ?? "deepseek-chat",`,
  `      model: structuredFallback?.model === "deepseek-chat" || structuredFallback?.model === "deepseek-reasoner"\n        ? "deepseek-v4-flash"\n        : structuredFallback?.model ?? "deepseek-v4-flash",`,
  "model routes legacy DeepSeek fallback",
);

// Server-side migration: old DeepSeek aliases were retired; normalize them to the current V4 Flash id.
replaceOnce(
  "server/src/llm/structuredFallbackSettings.ts",
  `  model: "deepseek-chat",`,
  `  model: "deepseek-v4-flash",`,
  "server structured fallback default",
);
replaceOnce(
  "server/src/llm/structuredFallbackSettings.ts",
  `function normalizeModel(value: string | undefined | null): string {\n  return value?.trim() || DEFAULT_STRUCTURED_FALLBACK_SETTINGS.model;\n}`,
  `function normalizeModel(value: string | undefined | null): string {\n  const normalized = value?.trim();\n  if (normalized === "deepseek-chat" || normalized === "deepseek-reasoner") {\n    return "deepseek-v4-flash";\n  }\n  return normalized || DEFAULT_STRUCTURED_FALLBACK_SETTINGS.model;\n}`,
  "server legacy model migration",
);

console.log("Applied Android DeepSeek-only provider overlay and legacy model migration.");
