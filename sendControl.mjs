import mqtt from "mqtt";



const topic = process.argv[2] || "vitals/control/001";
const msg = JSON.parse(process.argv[3] || '{"set":{"spO2":"RED"},"durationSec":60}');



const client = mqtt.connect("mqtt://localhost:1883");
client.on("connect", () => {
  client.publish(topic, JSON.stringify(msg), () => {
    console.log("✅ Sent", topic, msg);
    client.end();
  });
});
