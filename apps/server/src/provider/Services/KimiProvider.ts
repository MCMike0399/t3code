import { Context } from "effect";

import type { ServerProviderShape } from "./ServerProvider.ts";

export interface KimiProviderShape extends ServerProviderShape {}

export class KimiProvider extends Context.Service<KimiProvider, KimiProviderShape>()(
  "t3/provider/Services/KimiProvider",
) {}
