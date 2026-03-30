import { type TelemetryEvent, type TelemetryEventType } from "./types.js";
export interface TelemetrySink {
    write(event: TelemetryEvent): void;
}
export declare class TelemetryEmitter {
    private readonly sandboxId;
    private readonly sinks;
    constructor(opts?: {
        sandboxId?: string;
        sinks?: TelemetrySink[];
    });
    emit(eventType: TelemetryEventType, data?: Record<string, unknown>): void;
}
//# sourceMappingURL=emitter.d.ts.map