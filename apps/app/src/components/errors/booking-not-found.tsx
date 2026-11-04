import { BackButton, ErrorScreen } from "@synoro/ui";

/** Адреса записи нет: о кабинете и главной Synoro посетителю знать незачем. */
export function BookingNotFound() {
  return (
    <ErrorScreen
      code="404"
      title="Страница записи не найдена"
      description="Возможно, адрес изменился или в ссылке опечатка. Проверьте ссылку или попросите новую у специалиста."
      brand={false}
    >
      <BackButton />
    </ErrorScreen>
  );
}
