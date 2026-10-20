import localFont from "next/font/local"
import "./lab.css"

const inter = localFont({
  src: [
    { path: "../../../assets/fonts/Inter-Regular.ttf", weight: "400" },
    { path: "../../../assets/fonts/Inter-Bold.ttf", weight: "700" },
    { path: "../../../assets/fonts/Inter-Black.ttf", weight: "900" },
  ], variable: "--lab-inter", display: "swap"
})
const rubik = localFont({
  src: [
    { path: "../../../assets/fonts/Rubik-Regular.ttf", weight: "400" },
    { path: "../../../assets/fonts/Rubik-Bold.ttf", weight: "700" },
    { path: "../../../assets/fonts/Rubik-Black.ttf", weight: "900" },
  ], variable: "--lab-rubik", display: "swap"
})
const symbols = localFont({ src: "../../../assets/fonts/NotoSansSymbols2-Regular.ttf", variable: "--lab-symbols", display: "swap" })

export default function LabLayout({ children }: { children: React.ReactNode }) {
  return <div className={`badge-lab ${inter.variable} ${rubik.variable} ${symbols.variable}`}>{children}</div>
}
