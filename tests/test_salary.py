from jobboard import salary

RATES = {"CAD": 1.0, "USD": 1.38, "GBP": 1.8}


def test_cad_range_per_year():
    p = salary.parse("The base salary range is CA$86,000 – CA$106,000 per year.", "USD")
    assert p == {"min": 86000, "max": 106000, "currency": "CAD", "interval": "year"}


def test_k_suffix_and_default_currency():
    p = salary.parse("Salary: $90k-110k", "CAD")
    assert p["min"] == 90000 and p["max"] == 110000 and p["currency"] == "CAD"


def test_hourly():
    p = salary.parse("Pay: $38.12 - $54.80 an hour", "CAD")
    assert p["interval"] == "hour"
    assert salary.to_cad_annual(p, RATES)[1] == round(54.80 * 2080)


def test_usd_tail_and_conversion():
    p = salary.parse("Compensation $120,000 - $150,000 USD", "CAD")
    assert p["currency"] == "USD"
    assert salary.to_cad_annual(p, RATES) == (165600, 207000)


def test_ignores_company_size_and_funding():
    assert salary.parse("We raised $50M and serve $2 billion in payments.", "USD") is None


def test_single_figure_needs_pay_words():
    assert salary.parse("We donate $500 to a charity of your choice.", "USD") is None
    p = salary.parse("Base salary: $95,000", "CAD")
    assert p["max"] == 95000


def test_display_shows_cad_for_foreign_pay():
    out = salary.display({"min": 120000, "max": 150000, "currency": "USD", "interval": "year"}, RATES)
    assert out.startswith("US$120k–150k/yr") and "C$166k–207k" in out


def test_display_none():
    assert salary.display(None, RATES) == "Salary not posted"
