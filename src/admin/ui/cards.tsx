/** @jsxImportSource hono/jsx */
import type { View } from "./layout.tsx";

export function DesignedCardsPanel({ v, qaf }: { v: View; qaf: boolean }) {
   const ar = v.prefs.lang === "ar";
   const t = (en: string, arabic: string) => ar ? arabic : en;
   return <section class="card stack" data-designed-cards hidden>
      <h2>{t("Community card", "بطاقة مجتمع")}</h2>
      <div class="stack" data-card-fields>
         <label>{t("Source", "المصدر")}
            <select class="input" data-card-kind>
               <option value="quran">{t("Quran verse", "آية من القرآن")}</option>
               {qaf ? <option value="qaf">{t("Qaf quotation", "اقتباس من قاف")}</option> : null}
               <option value="message">{t("Your message", "رسالتك")}</option>
            </select>
         </label>
         <div class="stack" data-card-source="quran">
            <label>{t("Surah number", "رقم السورة")}<input class="input" inputmode="numeric" maxlength={3} data-card-surah /></label>
            <label>{t("Verse number", "رقم الآية")}<input class="input" inputmode="numeric" maxlength={3} data-card-ayah /></label>
         </div>
         {qaf ? <div class="stack" data-card-source="qaf" hidden>
            <button class="btn" type="button" data-qaf-open data-card-pick>{t("Find Qaf quotation", "ابحث في قاف")}</button>
            <p dir="auto" data-card-passage />
         </div> : null}
         <label data-card-source="message" hidden>{t("Message", "الرسالة")}
            <textarea class="input" maxlength={600} dir="auto" rows={4} data-card-message />
         </label>
         <label>{t("Template", "القالب")}
            <select class="input" data-card-template>
               <option value="fawanees">{t("Fawanees", "فوانيس")}</option>
               <option value="folio">{t("Folio", "المخطوط")}</option>
               <option value="editorial">{t("Editorial", "تحريري")}</option>
            </select>
         </label>
         <label>{t("Colour", "اللون")}
            <select class="input" data-card-palette><option value="0">{t("Primary", "أساسي")}</option><option value="1">{t("Alternate", "بديل")}</option></select>
         </label>
         <label>{t("Format", "الأبعاد")}
            <select class="input" data-card-format><option value="square">{t("Square", "مربع")}</option><option value="portrait">{t("Portrait", "عمودي")}</option></select>
         </label>
      </div>
      <div data-card-preview hidden style="position:relative;width:100%;overflow:hidden"></div>
      <p aria-live="polite" data-card-status />
      <div class="actions">
         <button class="btn" type="button" data-card-action="preview">{t("Preview", "معاينة")}</button>
         <button class="btn primary" type="button" data-card-action="publish" disabled>{t("Publish card", "نشر البطاقة")}</button>
      </div>
   </section>;
}
