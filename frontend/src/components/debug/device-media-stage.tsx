"use client";

import Image from "next/image";
import { type Ref } from "react";
import styles from "./device-console.module.css";
import { useDeviceText } from "./device-tools";

export default function DeviceMediaStage({
  videoRef,
  videoActive,
}: {
  videoRef: Ref<HTMLVideoElement>;
  videoActive: boolean;
}) {
  const d = useDeviceText();
  return (
    <div
      className={styles.videoArea}
      aria-label={d("Video capture", "视频采集")}
    >
      <div className={styles.video} data-device-video>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full object-contain"
        />
        {!videoActive && (
          <div className={styles.placeholder}>
            <Image
              src="/images/devices/android-dancing.gif"
              width={600}
              height={680}
              unoptimized
              alt={d(
                "Dancing Android robot — connect a capture card to begin",
                "跳舞的安卓机器人，连接采集卡后开始预览",
              )}
              className={styles.placeholderImage}
            />
          </div>
        )}
      </div>
    </div>
  );
}
