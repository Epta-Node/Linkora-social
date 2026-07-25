"use client";

import React from "react";
import { motion } from "framer-motion";

export interface ModalBackdropProps {
  onClick?: () => void;
  children?: React.ReactNode;
  className?: string;
}

export function ModalBackdrop({ onClick, children, className = "" }: ModalBackdropProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onClick={onClick}
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm ${className}`}
      style={{
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        backdropFilter: "blur(4px)",
      }}
    >
      {children}
    </motion.div>
  );
}
