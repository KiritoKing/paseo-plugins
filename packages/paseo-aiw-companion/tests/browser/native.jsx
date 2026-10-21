import { forwardRef, useLayoutEffect, useRef } from "react";
export const Platform = { OS: "web" };
export const PanResponder = { create: () => ({ panHandlers: {} }) };
function css(value) {
  const style = Array.isArray(value)
    ? Object.assign({}, ...value.filter(Boolean).map(css))
    : { ...value };
  for (const key of ["lineHeight"]) if (typeof style[key] === "number") style[key] += "px";
  if (
    style.borderWidth ||
    style.borderBottomWidth ||
    style.borderTopWidth ||
    style.borderRightWidth
  )
    style.borderStyle = "solid";
  for (const key of Object.keys(style)) if (style[key] === undefined) delete style[key];
  if (style.flex !== undefined) {
    style.flexGrow = style.flex;
    style.flexShrink = 1;
    style.flexBasis = 0;
    delete style.flex;
  }
  return style;
}
function props(p) {
  const result = {
    "data-testid": p.testID,
    role: p.accessibilityRole,
    "aria-label": p.accessibilityLabel,
  };
  if (p.accessibilityState?.selected !== undefined)
    result["aria-pressed"] = p.accessibilityState.selected;
  if (p.accessibilityState?.expanded !== undefined)
    result["aria-expanded"] = p.accessibilityState.expanded;
  return result;
}
export function View({ children, style, onLayout, ...rest }) {
  const ref = useRef(null),
    callback = useRef(onLayout);
  callback.current = onLayout;
  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      callback.current?.({
        nativeEvent: {
          layout: { width: entry.contentRect.width, height: entry.contentRect.height },
        },
      }),
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      {...props(rest)}
      style={{
        display: "flex",
        flexDirection: "column",
        position: "relative",
        minWidth: 0,
        ...css(style),
      }}
    >
      {children}
    </div>
  );
}
export function Text({ children, style, numberOfLines, ...rest }) {
  return (
    <span
      {...props(rest)}
      style={{
        overflowWrap: "anywhere",
        ...(numberOfLines === 1
          ? { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }
          : {}),
        ...css(style),
      }}
    >
      {children}
    </span>
  );
}
export function Pressable({ children, style, onPress, disabled, ...rest }) {
  return (
    <button
      type="button"
      {...props(rest)}
      disabled={disabled}
      onClick={onPress}
      style={{
        display: "flex",
        flexDirection: "column",
        font: "inherit",
        textAlign: "left",
        cursor: "pointer",
        padding: 0,
        border: 0,
        backgroundColor: "transparent",
        flexShrink: 0,
        ...css(typeof style === "function" ? style({ pressed: false }) : style),
      }}
    >
      {children}
    </button>
  );
}
export const TextInput = forwardRef(function TextInput(
  { value, onChangeText, onSubmitEditing, multiline, style, placeholderTextColor, ...rest },
  ref,
) {
  const Tag = multiline ? "textarea" : "input";
  return (
    <Tag
      ref={ref}
      {...props(rest)}
      value={value}
      placeholder={rest.placeholder}
      onChange={(event) => onChangeText?.(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey && !multiline) {
          event.preventDefault();
          onSubmitEditing?.();
        }
      }}
      style={{
        font: "inherit",
        outline: "none",
        backgroundColor: "transparent",
        borderStyle: "solid",
        borderWidth: 0,
        resize: "vertical",
        ...css(style),
      }}
    />
  );
});
export function Switch({ value, onValueChange, ...rest }) {
  return (
    <input
      type="checkbox"
      {...props(rest)}
      checked={value}
      onChange={(event) => onValueChange(event.target.checked)}
    />
  );
}
export function ScrollView({ children, style, contentContainerStyle, horizontal, ...rest }) {
  return (
    <View {...rest} style={{ minHeight: 0, overflow: "auto", ...css(style) }}>
      <View style={{ flexDirection: horizontal ? "row" : "column", ...css(contentContainerStyle) }}>
        {children}
      </View>
    </View>
  );
}
