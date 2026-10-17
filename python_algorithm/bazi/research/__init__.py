"""Offline research and verification code: nothing the running service imports lives here.

  cases/         the classical cases: extraction from the knowledge base, annotations, review sheets, the tuning / validation split
  calibration/   D: grid search and cross-validation of the factor weights (tuning group only)
  evaluation/    E: strength, pattern and 调候 figures on the validation group (opened once, through cases/validation.py)
  validation/    cross-validation of the chart against lunar-python and an ephemeris, and the experiments built on it
  knowledge.py   reads the project knowledge base, to check that every cited quotation is on the page it cites
  build_basics.py, build_cities.py   rebuild the data files the engine reads (data/basics/*.json, data/cities.tsv)
  data/          the cases, the calibration and evaluation reports
  tests/         the tests of the above

The service (routers -> engine -> calc, diagnosis, advisory, rules, basics, geo, models) never imports this package; a test
(tests/test_independence.py) keeps it so.
"""
