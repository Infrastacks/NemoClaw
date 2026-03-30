import type { TelemetrySink } from "./emitter.js";
import type { TelemetryEvent } from "./types.js";
export declare class StdoutSink implements TelemetrySink {
    write(event: TelemetryEvent): void;
}
export declare class FileSink implements TelemetrySink {
    private readonly path;
    constructor(path?: string);
    write(event: TelemetryEvent): void;
}
//# sourceMappingURL=sinks.d.ts.map