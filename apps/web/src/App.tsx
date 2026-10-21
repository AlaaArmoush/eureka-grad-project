import { useEffect } from "react";
import { useRef, useState } from "react";
import { mountPixiCircle } from "./lab/renderer";

function CircleLab() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;

    if (host === null) {
      return;
    }

    return mountPixiCircle(host);
  }, []);

  return (
    <div
      aria-label="Eureka physics canvas"
      data-pixi-host
      ref={hostRef}
      role="img"
      style={{
        height: "360px",
        overflow: "hidden",
        width: "100%"
      }}
    />
  );
}

export function App() {
  const [labVisible, setLabVisible] = useState(true);

  return (
    <main
      style={{
        boxSizing: "border-box",
        fontFamily: "system-ui, sans-serif",
        margin: "0 auto",
        maxWidth: "960px",
        padding: "24px"
      }}
    >
      <h1>Eureka</h1>

      <button
        onClick={() => {
          setLabVisible((visible) => !visible);
        }}
        type="button"
      >
        {labVisible ? "Leave lab" : "Enter lab"}
      </button>

      <section
        aria-label="Physics laboratory"
        style={{ marginTop: "16px" }}
      >
        {labVisible ? <CircleLab /> : <p>The lab is closed.</p>}
      </section>
    </main>
  );
}
