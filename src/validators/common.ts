import { z } from "zod";

export function isValidCpf(input: string): boolean {
  const cpf = input.replace(/\D/g, "");
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digits = cpf.split("").map(Number);
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += digits[i]! * (len + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return calc(9) === digits[9] && calc(10) === digits[10];
}

export const uuidSchema = z.uuid();

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ message: "E-mail inválido" }));

export const personNameSchema = z
  .string()
  .trim()
  .min(3, "Informe o nome completo")
  .max(120)
  .regex(/^[\p{L}][\p{L}'´`.\- ]+$/u, "Nome contém caracteres inválidos")
  .refine((v) => v.split(/\s+/).length >= 2, "Informe nome e sobrenome");

export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/\D/g, ""))
  .refine((v) => v.length >= 10 && v.length <= 13, "Telefone inválido");

export const cpfSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/\D/g, ""))
  .refine(isValidCpf, "CPF inválido");

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use letras minúsculas, números e hífens");

/** Reais typed by an admin ("30", "30,00", "1.234,56") → integer cents. */
export const reaisToCentsSchema = z
  .string()
  .trim()
  .regex(/^\d{1,3}(\.?\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/, "Valor inválido")
  .transform((v) => {
    const [int, dec = ""] = v.replace(/\./g, "").split(",");
    return Number(int) * 100 + Number(dec.padEnd(2, "0"));
  });
