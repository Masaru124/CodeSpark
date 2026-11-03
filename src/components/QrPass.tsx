"use client";

import { QRCodeSVG } from "qrcode.react";

export default function QrPass({
  value,
  size = 148,
  className,
}: {
  value: string;
  size?: number;
  className?: string;
}) {
  return (
    <QRCodeSVG
      value={value}
      size={size}
      level="M"
      marginSize={2}
      bgColor="#ffffff"
      fgColor="#1d242e"
      className={className}
    />
  );
}
