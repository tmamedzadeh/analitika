import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { PasswordInput } from "./PasswordInput";

describe("independent password visibility", () => {
  it("preserves values, FormData and constraints while toggling one field", () => {
    render(
      <form aria-label="password form">
        <label>
          Yeni şifrə
          <PasswordInput
            name="password"
            defaultValue="synthetic-password"
            minLength={12}
            required
          />
        </label>
        <label>
          Təsdiq
          <PasswordInput name="confirmation" defaultValue="synthetic-confirmation" />
        </label>
      </form>,
    );
    const password = screen.getByLabelText("Yeni şifrə");
    const confirmation = screen.getByLabelText("Təsdiq");
    expect(password).toHaveAttribute("type", "password");
    const toggles = screen.getAllByRole("button", { name: "Şifrəni göstər" });
    toggles[0]!.focus();
    expect(toggles[0]).toHaveFocus();
    fireEvent.click(toggles[0]!);
    expect(password).toHaveAttribute("type", "text");
    expect(confirmation).toHaveAttribute("type", "password");
    expect(password).toHaveValue("synthetic-password");
    expect(password).toBeRequired();
    expect(password).toHaveAttribute("minlength", "12");
    expect(new FormData(screen.getByRole("form") as HTMLFormElement).get("password")).toBe(
      "synthetic-password",
    );
    fireEvent.click(screen.getByRole("button", { name: "Şifrəni gizlət" }));
    expect(password).toHaveAttribute("type", "password");
  });
});
