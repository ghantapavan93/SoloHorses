# ADR-009 — When fine-tuning would be appropriate, and why not now

**Situation.** The role asks for an understanding of model training and fine-tuning, including when they are appropriate.

**Decision.** No fine-tuning. The assistant's failure modes here are retrieval and grounding, not style or vocabulary. Those are handled by typed tools, a glossary in the cached system prompt, a deterministic evidence verifier, and an eval suite that runs the real pipeline. Terminology and user preferences are injected as explicit, inspectable memory rather than baked into weights, so a person can read and delete them.

**When it would be appropriate.** A large, stable corpus of graded transcripts (thousands, not dozens) where the model repeatedly misreads barn shorthand that no prompt fixes; a latency or cost target that a smaller tuned model meets and the prompted frontier model does not; or a narrow classification task (triaging inbound texts, say) with a labeled set. Even then: evals first, a held-out test set, and the tuned model behind the same tools and verifier.

**Would change it.** The eval suite showing a category the prompt cannot fix after two iterations, with enough labeled examples to train on.
