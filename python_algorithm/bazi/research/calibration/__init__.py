"""Calibration (D): fixing the weights of the five factors from the tuning group; the cut points are the design's.

    python -m bazi.research.calibration.run            # the weights; one report
    python -m bazi.research.calibration.run --freeze   # also write the weights into the rule base

Only the tuning group is read (annotations_strength_tuning.json); the validation group stays closed until the final
evaluation. What the cases decide are a handful of constants whose meaning the books and the project's definitions give
(see proposal v4, 6.3-6.7); nothing is learned at run time.
"""
