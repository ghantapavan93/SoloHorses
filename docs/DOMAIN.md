# Domain

The vocabulary and the lifecycle the code models. Definitions marked _public_ come from the operation's own pages and transcripts; _general_ are industry terms. Sources are in [research/A-solo-domain.md](research/A-solo-domain.md).

## Lifecycle of one embryo

```
 contract (SS-26-…)             donor mare (H-…)                 recip mare (R-…)
   reserve → deposit → sign        aspiration, Mondays             set up (synchronised)
   → paid in full → shippable      │                                │
                                   ▼                                │
                            lab batch (LAB-26-…)                    │
                            oocytes out → count back day 7–10       │
                                   │                                │
                                   ▼                                ▼
                            embryo (E-26-…) ── transfer (TR-26-…) ──▶ carrying
                            fresh, or vitrified in a tank           │
                                                                    ▼
                                            checks (CHK-26-…): day 14 · day 24 heartbeat · 45–60 · 55 · monthly
                                                                    │
                                              lease fee + board ◀───┤──▶ ICSI stallion fee ──▶ purchased embryo confirmed
                                                                    ▼
                                                     leased out at ~day 24+, back by December 1 · foaled · weaned
```

Shipped-in embryos skip the lab and arrive by text ("Cross: Sire x Dam, ICSI 4/14, 2 embryos, Tue by 1 PM, Dr. …"), announced → parsed → confirmed → expected → arrived.

## Codes

| Prefix                                        | Entity                             | Scoped    |
| --------------------------------------------- | ---------------------------------- | --------- |
| `C-0042`                                      | customer                           | permanent |
| `H-0012`                                      | horse (donor, stallion, sale)      | permanent |
| `R-0347`                                      | recipient mare (also "Recip #347") | permanent |
| `SS-26-0533`                                  | breeding contract                  | season    |
| `SO-26-0917`                                  | semen order                        | season    |
| `ASP-26-0211` / `LAB-26-0088`                 | aspiration / lab batch             | season    |
| `E-26-2041`                                   | embryo                             | season    |
| `TR-26-0512` / `CHK-26-0912`                  | transfer / pregnancy check         | season    |
| `INV-26-1093` / `PAY-26-0451` / `REF-26-0031` | invoice / payment / refund         | season    |

## Rules encoded (all public facts unless marked)

- Order semen by 5 PM Central the day before a collection; cancel by 8 AM the day of. Collections every other day February 1 – July 31 (the parity is anchored on Feb 1 — an assumption).
- Deposit + stud fee + chute fee paid, and the contract signed, before semen ships. Card top-ups carry the card fee.
- Fresh contracts expire with the season; ICSI contracts one year from purchase.
- Aspirations on Mondays; results back day 7–10; transfer window February 1 – July 15.
- Embryos preferred by 1 PM on transfer day; more recips are set up than used.
- Day-24 heartbeat → lease fee ($5,000 flush/thawed, $6,500 fresh ICSI) and board at $22/day. 45–60 days → ICSI stallion fee (the contract's stud fee). 55 days → purchased embryo confirmed. Open → redo or credit. Recip back by December 1 or $6,000.
- A text is not confirmed until the farm replies with the embryo codes.

## Glossary

| Term                         | Meaning                                                                     | Source  |
| ---------------------------- | --------------------------------------------------------------------------- | ------- |
| donor mare                   | the mare that provides the oocyte or embryo; the foal's genetic dam         | public  |
| recip / recipient mare       | carries the pregnancy, foals, nurses until weaning; identified by number    | public  |
| booking fee / deposit        | non-refundable, holds a slot, applied to the total                          | public  |
| chute fee                    | handling fee charged with the stud fee                                      | public  |
| stud fee                     | the stallion's fee; on ICSI contracts due at 45–60 days pregnant            | public  |
| fresh/cooled · frozen · ICSI | contract and semen types                                                    | public  |
| aspiration / OPU             | ultrasound-guided oocyte collection from a standing, sedated mare           | public  |
| ICSI                         | one sperm injected into an oocyte at an outside lab; cultured 7–10 days     | public  |
| flush                        | recovering an embryo from the donor's uterus about a week after ovulation   | public  |
| transfer / ET / implant      | placing an embryo into a synchronised recip                                 | public  |
| vitrify / thaw               | freezing an embryo; thawed embryos are transferred immediately              | public  |
| set up                       | recips synchronised for a transfer day                                      | public  |
| cultured clean               | negative uterine culture before semen ships                                 | public  |
| heartbeat check              | the day-24 ultrasound that starts the lease fee and board                   | public  |
| open                         | not pregnant                                                                | general |
| live foal (LFG)              | standing and nursing without assistance; terms vary and are not stated here | public  |
| board                        | daily care charge from the heartbeat until the mare leaves                  | public  |
| papers                       | breed-registry certificate, released when payment clears                    | public  |
| Coggins                      | EIA blood test required for travel                                          | public  |
| wet mare                     | mare with a foal at side                                                    | public  |
| fitting                      | 90–120 days of conditioning before a sale                                   | public  |
| settle by Monday             | auction purchases paid to the cashier by 5 PM the Monday after              | public  |

The same glossary, as data, is in `packages/domain/src/ask/glossary.ts` and is injected into the assistant's cached system prompt.
