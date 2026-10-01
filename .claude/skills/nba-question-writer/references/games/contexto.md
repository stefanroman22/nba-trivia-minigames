# LeContexto (contexto)

One secret player per day. Each guess shows how similar the guessed player is (a rank); rank 1
is the secret ("HOME IN BY SIMILARITY").

## Where it lives

- Generator: `backend/trivia/questions/games/contexto.py`; similarity in `backend/trivia/questions/similarity.py`;
  renderer `src/Game Renderers/Contexto.tsx`.
- Definition `{"secret_person_id": N, "day": "YYYY-MM-DD"}`. 60 days scheduled ahead, MINIMUM 30,
  no secret repeats within 365 days. Secrets are fame tier 1-2.
- The ranking must start with the secret at rank 1, with no duplicates.

## What "writing content" means here

- Pick secrets a casual fan can reach within a few dozen guesses: stars with distinctive résumés.
- Similarity uses award counts and career facts, so a player with an empty awards record ranks
  poorly against everyone. Avoid such players as secrets.
- Rankings should feel right to a fan: teammates and players of the same era and role should sit
  near each other. If a near-identical résumé ranks far away, report it as a similarity bug rather
  than tweaking the secret list.

## Validate

```
DATABASE_URL="" python manage.py test trivia.tests.test_questions_contexto trivia.tests.test_contexto
```
