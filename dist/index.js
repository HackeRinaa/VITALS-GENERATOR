import mqtt from "mqtt";
function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}
/** Last field `as`: activity status for the receiver parser. */
function activityStatusToAs(s) {
    if (s === "resting")
        return 1;
    if (s === "walking" || s === "fast walk")
        return 2;
    return 3;
}
const BROKER_URL = process.env.MQTT_URL || "mqtt://localhost:1883";
const INTERVAL_MS = Number(process.env.INTERVAL_MS || "20000");
const MQTT_USER = process.env.MQTT_USER ?? process.env.MQTT_USERNAME ?? "generator-client";
const MQTT_PASS = process.env.MQTT_PASS ?? process.env.MQTT_PASSWORD ?? "";
const MQTT_QOS = Number(process.env.MQTT_QOS || "1");
const MQTT_RETAIN = (process.env.MQTT_RETAIN || "false").toLowerCase() === "true";
const MQTT_RECONNECT_MS = Number(process.env.MQTT_RECONNECT_MS || "1500");
const ENABLE_CONTROL_SUBSCRIPTION = (process.env.ENABLE_CONTROL_SUBSCRIPTION || "false").toLowerCase() === "true";
const sourceIdsRaw = process.env.MQTT_SOURCE_IDS ||
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
function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randFloat(min, max, decimals = 1) {
    const v = Math.random() * (max - min) + min;
    const p = Math.pow(10, decimals);
    return Math.round(v * p) / p;
}
function toClockTime(d) {
    return d.toISOString().slice(11, 19);
}
function toField(value) {
    if (value === null || value === undefined)
        return "";
    if (typeof value === "number" && Number.isNaN(value))
        return "";
    return String(value);
}
function topicVitals(id) {
    return `in.vitals.gen/${id}`;
}
function topicControl(id) {
    return `in.vitals.gen/control/${id}`;
}
const GREEN = {
    respRate: [12, 20],
    spO2: [95, 100],
    heartRate: [50, 100],
    heartRateVar: [31, 80],
    bpSystolic: [100, 140],
    bpDiastolic: [60, 90],
    temp: [36.0, 37.9],
    painScale: [1, 5],
};
const YELLOW = {
    respRate: [21, 30],
    spO2: [90, 94],
    heartRate: [101, 130],
    heartRateVar: [15, 30],
    bpSystolic: [90, 99],
    bpDiastolic: [50, 59],
    temp: [38.0, 39.0],
    painScale: [6, 7],
};
const RED = {
    respRate: [31, 40],
    spO2: [70, 89],
    heartRate: [131, 160],
    heartRateVar: [1, 14],
    bpSystolic: [60, 89],
    bpDiastolic: [30, 49],
    temp: [39.1, 40.5],
    painScale: [8, 10],
};
function genFromRange(key, zone) {
    const [min, max] = zone === "GREEN" ? GREEN[key] :
        zone === "YELLOW" ? YELLOW[key] :
            RED[key];
    if (key === "temp")
        return randFloat(min, max, 1);
    return randInt(Math.ceil(min), Math.floor(max));
}
const overrides = new Map();
function getOverride(id) {
    const ov = overrides.get(id);
    if (!ov)
        return undefined;
    if (ov.expiresAt && Date.now() > ov.expiresAt) {
        overrides.delete(id);
        return undefined;
    }
    return ov;
}
function genAvpu(zone) {
    if (zone === "GREEN")
        return "a";
    if (zone === "YELLOW")
        return "v";
    return pick(["p", "u"]);
}
function genVitals(id) {
    const ov = getOverride(id);
    const out = {};
    Object.keys(GREEN).forEach((k) => {
        let val = genFromRange(k, "GREEN");
        if (ov?.zone)
            val = genFromRange(k, ov.zone);
        const per = ov?.set?.[k];
        if (typeof per === "number")
            val = per;
        else if (per === "GREEN" || per === "YELLOW" || per === "RED")
            val = genFromRange(k, per);
        out[k] = val;
    });
    let avpu = ov?.zone ? genAvpu(ov.zone) : "a";
    const perAvpu = ov?.set?.avpu;
    if (perAvpu === "a" || perAvpu === "v" || perAvpu === "p" || perAvpu === "u") {
        avpu = perAvpu;
    }
    else if (perAvpu === "GREEN" || perAvpu === "YELLOW" || perAvpu === "RED") {
        avpu = genAvpu(perAvpu);
    }
    out.avpu = avpu;
    return out;
}
client.on("connect", () => {
    console.log("✅ Connected to MQTT:", BROKER_URL);
    console.log(`📤 Publishing every ${INTERVAL_MS}ms for sources: ${SOURCE_IDS.join(", ")} (QoS=${MQTT_QOS}, retain=${MQTT_RETAIN})`);
    if (ENABLE_CONTROL_SUBSCRIPTION) {
        client.subscribe("in.vitals.gen/control/all");
        for (const id of SOURCE_IDS)
            client.subscribe(topicControl(id));
        console.log("🎛️ Listening on in.vitals.gen/control/<sourceId> and in.vitals.gen/control/all");
    }
    else {
        console.log("🎛️ Control subscription disabled (ENABLE_CONTROL_SUBSCRIPTION=false)");
    }
});
client.on("message", (topic, payload) => {
    if (!ENABLE_CONTROL_SUBSCRIPTION)
        return;
    if (!topic.startsWith("in.vitals.gen/control/"))
        return;
    let msg;
    try {
        msg = JSON.parse(payload.toString());
    }
    catch {
        console.log("❌ Bad control JSON:", payload.toString());
        return;
    }
    const target = topic.split("/")[2]; // all or deviceId
    const expiresAt = msg.durationSec ? Date.now() + msg.durationSec * 1000 : undefined;
    const applyTo = (id) => {
        if (msg.clear) {
            overrides.delete(id);
            return;
        }
        overrides.set(id, { zone: msg.zone, set: msg.set, expiresAt });
    };
    if (target === "all") {
        for (const id of SOURCE_IDS)
            applyTo(id);
        console.log("🎚️ Control applied to ALL:", msg);
    }
    else {
        applyTo(target);
        console.log(`🎚️ Control applied to ${target}:`, msg);
    }
});
setInterval(() => {
    if (!client.connected)
        return;
    const now = new Date();
    const ts = now.toISOString();
    const tsClock = toClockTime(now);
    for (const id of SOURCE_IDS) {
        const vitals = genVitals(id);
        const hmdId = Number(id);
        const activity = pick([
            "resting",
            "walking",
            "running",
            "engaged",
            "taking cover",
            "sprinting",
            "fast walk",
        ]);
        const as = activityStatusToAs(activity);
        const payloadFields = [
            tsClock,
            Number.isNaN(hmdId) ? id : hmdId,
            vitals.respRate,
            100, // rrc
            vitals.spO2,
            100, // spo2c
            vitals.heartRate,
            95, // hrc
            vitals.heartRateVar,
            vitals.bpSystolic,
            vitals.bpDiastolic,
            vitals.temp,
            as,
        ];
        const payload = payloadFields.map(toField).join(";");
        client.publish(topicVitals(id), payload, {
            qos: MQTT_QOS,
            retain: MQTT_RETAIN,
        });
    }
    console.log(`➡️ Published @ ${ts} for ${SOURCE_IDS.join(", ")}`);
}, INTERVAL_MS);
