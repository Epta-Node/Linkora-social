"use client";

import React, { forwardRef } from "react";
import TextareaAutosize, { TextareaAutosizeProps } from "react-textarea-autosize";

export interface AutoResizeTextareaProps extends TextareaAutosizeProps {
  className?: string;
}

export const AutoResizeTextarea = forwardRef<HTMLTextAreaElement, AutoResizeTextareaProps>(
  (
    { className = "", minRows = 3, maxRows = 7, placeholder = "What's happening?", ...props },
    ref
  ) => {
    return (
      <TextareaAutosize
        ref={ref}
        minRows={minRows}
        maxRows={maxRows}
        placeholder={placeholder}
        className={`w-full resize-none rounded-lg border border-[#E5E7EB] bg-white px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all duration-150 ${className}`}
        style={{
          minHeight: "80px",
          maxHeight: "200px",
          ...props.style,
        }}
        {...props}
      />
    );
  }
);

AutoResizeTextarea.displayName = "AutoResizeTextarea";
