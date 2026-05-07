
import mqtt from "mqtt";

type AVPU = "a" | "v" | "p" | "u";
type Vitals = {
  respRate: number;
  spO2: number;
  heartRate: number;
  heartRateVar: number;
  bpSystolic: number;
  bpDiastolic: number;
  temp: number;
  painScale: number;
  avpu: AVPU;
};

type VitalKey = keyof Vitals;
type Zone = "GREEN" | "YELLOW" | "RED";

type ControlMessage = {
  zone?: Zone;
  set?: Partial<Record<VitalKey, Zone | number | AVPU>>;
  durationSec?: number;
  clear?: boolean;
};
type RespAirCnd = "clean" | "dust" | "smoke (light)";
type MentalAlertness = "focused" | "alert" | "stressed";
type ActivityStatus =
  | "resting"
  | "walking"
  | "running"
  | "engaged"
  | "taking cover"
  | "sprinting"
  | "fast walk";

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
type NumericVitalKey = Exclude<VitalKey, "avpu">;

const BROKER_URL = process.env.MQTT_URL || "mqtt://localhost:1883";
const INTERVAL_MS = Number(process.env.INTERVAL_MS || "20000");
const MQTT_USER = process.env.MQTT_USER ?? process.env.MQTT_USERNAME ?? "generator-client";
const MQTT_PASS = process.env.MQTT_PASS ?? process.env.MQTT_PASSWORD ?? "";
const MQTT_QOS = Number(process.env.MQTT_QOS || "1") as 0 | 1 | 2;
const MQTT_RETAIN = (process.env.MQTT_RETAIN || "false").toLowerCase() === "true";
const MQTT_RECONNECT_MS = Number(process.env.MQTT_RECONNECT_MS || "1500");
const ENABLE_CONTROL_SUBSCRIPTION =
  (process.env.ENABLE_CONTROL_SUBSCRIPTION || "false").toLowerCase() === "true";

const sourceIdsRaw =
  process.env.MQTT_SOURCE_IDS ||
  process.env.DEVICE_IDS ||
  process.env.MQTT_SOURCE_ID ||
  "061,072,068,065,064,066,058,060";
const SOURCE_IDS = sourceIdsRaw
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const client = mqtt.connect(BROKER_URL, {
  username: MQTT_USER,
  password: MQTT_PASS,
  reconnectPeriod: MQTT_RECONNECT_MS,
});

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randFloat(min: number, max: number, decimals = 1) {
  const v = Math.random() * (max - min) + min;
  const p = Math.pow(10, decimals);
  return Math.round(v * p) / p;
}

function topicVitals(id: string) {
  return `vitals/generator/${id}`;
}
function topicControl(id: string) {
  return `vitals/control/${id}`;
}

const GREEN: Record<NumericVitalKey, [number, number]> = {
  respRate: [12, 20],
  spO2: [95, 100],
  heartRate: [50, 100],
  heartRateVar: [31, 80],
  bpSystolic: [100, 140],
  bpDiastolic: [60, 90],
  temp: [36.0, 37.9],
  painScale: [1, 5],
};

const YELLOW: Record<NumericVitalKey, [number, number]> = {
  respRate: [21, 30],
  spO2: [90, 94],
  heartRate: [101, 130],
  heartRateVar: [15, 30],
  bpSystolic: [90, 99],
  bpDiastolic: [50, 59],
  temp: [38.0, 39.0],
  painScale: [6, 7],
};

const RED: Record<NumericVitalKey, [number, number]> = {
  respRate: [31, 40],
  spO2: [70, 89],
  heartRate: [131, 160],
  heartRateVar: [1, 14],
  bpSystolic: [60, 89],
  bpDiastolic: [30, 49],
  temp: [39.1, 40.5],
  painScale: [8, 10],
};

function genFromRange(key: NumericVitalKey, zone: Zone): number {
  const [min, max] =
    zone === "GREEN" ? GREEN[key] :
      zone === "YELLOW" ? YELLOW[key] :
        RED[key];

  if (key === "temp") return randFloat(min, max, 1);
  return randInt(Math.ceil(min), Math.floor(max));
}

type DeviceOverride = {
  zone?: Zone;
  set?: Partial<Record<VitalKey, Zone | number | AVPU>>;
  expiresAt?: number;
};

const overrides = new Map<string, DeviceOverride>();

function getOverride(id: string): DeviceOverride | undefined {
  const ov = overrides.get(id);
  if (!ov) return undefined;
  if (ov.expiresAt && Date.now() > ov.expiresAt) {
    overrides.delete(id);
    return undefined;
  }
  return ov;
}

function genAvpu(zone: Zone): AVPU {
  if (zone === "GREEN") return "a";
  if (zone === "YELLOW") return "v";
  return pick<AVPU>(["p", "u"]);
}

function genVitals(id: string): Vitals {
  const ov = getOverride(id);
  const out: Partial<Vitals> = {};

  (Object.keys(GREEN) as NumericVitalKey[]).forEach((k) => {
    let val = genFromRange(k, "GREEN");
    if (ov?.zone) val = genFromRange(k, ov.zone);

    const per = ov?.set?.[k];
    if (typeof per === "number") val = per;
    else if (per === "GREEN" || per === "YELLOW" || per === "RED") val = genFromRange(k, per);

    out[k] = val;
  });

  let avpu: AVPU = ov?.zone ? genAvpu(ov.zone) : "a";

  const perAvpu = ov?.set?.avpu;
  if (perAvpu === "a" || perAvpu === "v" || perAvpu === "p" || perAvpu === "u") {
    avpu = perAvpu;
  } else if (perAvpu === "GREEN" || perAvpu === "YELLOW" || perAvpu === "RED") {
    avpu = genAvpu(perAvpu);
  }

  out.avpu = avpu;

  return out as Vitals;
}

client.on("connect", () => {
  console.log("✅ Connected to MQTT:", BROKER_URL);
  console.log(
    `📤 Publishing every ${INTERVAL_MS}ms for sources: ${SOURCE_IDS.join(", ")} (QoS=${MQTT_QOS}, retain=${MQTT_RETAIN})`,
  );

  if (ENABLE_CONTROL_SUBSCRIPTION) {
    client.subscribe("vitals/control/all");
    for (const id of SOURCE_IDS) client.subscribe(topicControl(id));
    console.log("🎛️ Listening on vitals/control/<sourceId> and vitals/control/all");
  } else {
    console.log("🎛️ Control subscription disabled (ENABLE_CONTROL_SUBSCRIPTION=false)");
  }
});

client.on("message", (topic, payload) => {
  if (!ENABLE_CONTROL_SUBSCRIPTION) return;
  if (!topic.startsWith("vitals/control/")) return;

  let msg: ControlMessage;
  try {
    msg = JSON.parse(payload.toString());
  } catch {
    console.log("❌ Bad control JSON:", payload.toString());
    return;
  }

  const target = topic.split("/")[2]; // all or deviceId
  const expiresAt = msg.durationSec ? Date.now() + msg.durationSec * 1000 : undefined;

  const applyTo = (id: string) => {
    if (msg.clear) {
      overrides.delete(id);
      return;
    }
    overrides.set(id, { zone: msg.zone, set: msg.set, expiresAt });
  };

  if (target === "all") {
    for (const id of SOURCE_IDS) applyTo(id);
    console.log("🎚️ Control applied to ALL:", msg);
  } else {
    applyTo(target);
    console.log(`🎚️ Control applied to ${target}:`, msg);
  }
});

setInterval(() => {
  if (!client.connected) return;

  const ts = new Date().toISOString();

  for (const id of SOURCE_IDS) {
    const vitals = genVitals(id);
    const payload = {
      source: "generator",
      sourceId: id,
      hr: vitals.heartRate,
      spo2: vitals.spO2,
      rr: vitals.respRate,
      ts,
      vitals,
      respAirCnd: pick<RespAirCnd>(["clean", "dust", "smoke (light)"]),
      mentalAlertness: pick<MentalAlertness>(["focused", "alert", "stressed"]),
      activityStatus: pick<ActivityStatus>([
        "resting",
        "walking",
        "running",
        "engaged",
        "taking cover",
        "sprinting",
        "fast walk",
      ]),
    };

    client.publish(topicVitals(id), JSON.stringify(payload), {
      qos: MQTT_QOS,
      retain: MQTT_RETAIN,
    });
  }

  console.log(`➡️ Published @ ${ts} for ${SOURCE_IDS.join(", ")}`);
}, INTERVAL_MS);
