import type { AccountView } from "../../src/server/account-gateway-accounts";

export const accountsCopy = {
  rename: "Переименовать",
  reconnectKey: "Обновить ключ",
  connectKey: "Подключить по API key",
  reconnectOAuth: "Обновить вход Codex",
  connectOAuth: "Подключить Codex OAuth",
  suspend: "Выключить",
  resume: "Включить",
  deleteConnection: "Удалить подключение…",
  detach: "Убрать из этого workspace",
  own: "Мои подключения",
  available: "Доступные в этом workspace",
  access: "Доступ",
  add: "Добавить аккаунт",
  connect: "Подключить аккаунт",
  personal: "Личный",
  ownerUnavailable: "Владелец недоступен",
  privacy: "Есть доступ с ограниченной видимостью",
} as const;

export function accountStatus(
  account: Pick<AccountView, "state" | "readiness" | "lifecycle">,
): string {
  if (
    account.lifecycle?.status === "pending" &&
    account.lifecycle.action === "delete"
  )
    return "Удаляем…";
  if (account.readiness === "unknown") return "Результат пока неизвестен";
  if (account.readiness === "pending") return "Подтверждаем изменение";
  if (account.state === "disabled" || account.state === "tombstoned")
    return "Отключен навсегда";
  if (account.state === "suspended") return "Выключен";
  if (account.state === "quarantined") return "Требует внимания";
  if (account.state === "staging") return "Подтверждаем подключение";
  if (account.readiness === "unavailable") return "Недоступен";
  return account.state === "active" ? "Готов" : "Недоступен";
}
