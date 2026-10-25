import { splitProps } from "solid-js";
import { Dialog as DialogPrimitive } from "@kobalte/core/dialog";
import { mergeClass } from "@/utils/classes";
import styles from "./Dialog.module.css";

function Root(props) {
  return <DialogPrimitive {...props} />;
}

function Content(props) {
  // classList is merged, not passed on: a caller's classList used to replace the panel's own classes,
  // leaving the dialog unpositioned under its overlay (WorkSuite's Sign in dialog never showed)
  const [local, rest] = splitProps(props, ["class", "classList"]);
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay class={styles.overlay} />
      <DialogPrimitive.Content classList={{ ...mergeClass(styles.content, local.class), ...local.classList }} {...rest} />
    </DialogPrimitive.Portal>
  );
}

function Title(props) {
  return <DialogPrimitive.Title {...props} />;
}

function CloseButton(props) {
  return <DialogPrimitive.CloseButton {...props} />;
}

export const Dialog = Object.assign(Root, { Content, Title, CloseButton });
