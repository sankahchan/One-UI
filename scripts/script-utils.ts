import { DynamicAccessKey } from "@prisma/client";

import { DynamicAccessKeyStats } from "./script-definitions";

export const getDakExpiryDateBasedOnValidityPeriod = (dak: DynamicAccessKey | DynamicAccessKeyStats) => {
    return dak.usageStartedAt && dak.validityPeriod
        ? new Date(new Date(dak.usageStartedAt).getTime() + Number(dak.validityPeriod) * 24 * 60 * 60 * 1000)
        : null;
};
