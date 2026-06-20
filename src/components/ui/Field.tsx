import { forwardRef, type InputHTMLAttributes } from "react";

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  search?: boolean;
}

/** Design-system text input. Use `search` for the left-icon search variant. */
const Field = forwardRef<HTMLInputElement, FieldProps>(({ search = false, className = "", ...rest }, ref) => (
  <input ref={ref} className={`field${search ? " field-search" : ""}${className ? " " + className : ""}`} {...rest} />
));

Field.displayName = "Field";
export default Field;
