// F-256 money against the shared vectors (F-313, A-37), under Robolectric at the configured SDK.
// TP-13.9. The vectors come from packages/shared/test-vectors through the test resources source dir.
//
// Assumed Kotlin shapes (F-256 says "mirrors of F-300 to F-305" without signatures; see the S-13
// questions): Money.of(minor: BigInteger, currency: String); Rational(num: BigInteger,
// den: BigInteger) and parseDecimal(text): Rational; roundHalfEven(r: Rational): BigInteger;
// allocate(m: Money, weights: List<BigInteger>): List<Money>; convertWithRates(m, RateSide(unitsPerUsd,
// minorUnits), RateSide(unitsPerUsd, minorUnits, currency)): Money; formatMoney(m, locale: Locale,
// minorUnits: Int): String; toWire(m): Long throwing MoneyRangeError.
package com.budmon.app.core.money

import java.math.BigInteger
import java.util.Locale
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class MoneyVectorsTest {
    private fun cases(name: String): List<JsonObject> {
        val text = checkNotNull(javaClass.classLoader?.getResource("$name.json")) { "$name.json not on the test classpath" }.readText()
        val root = Json.parseToJsonElement(text).jsonObject
        assertEquals(1, root["version"]?.jsonPrimitive?.int)
        return root["cases"]!!.jsonArray.map { it.jsonObject }
    }

    private fun JsonObject.s(key: String) = this[key]!!.jsonPrimitive.content
    private fun big(s: String) = BigInteger(s)

    /** A-37: U+00A0 and U+202F compare as U+0020. */
    private fun normalise(s: String) = s.replace(' ', ' ').replace(' ', ' ')

    @Test
    fun `TP-13_9 rounding vectors`() {
        val all = cases("rounding")
        assertTrue(all.isNotEmpty())
        for (c in all) {
            assertEquals(c.toString(), big(c.s("expected")), roundHalfEven(Rational(big(c.s("num")), big(c.s("den")))))
        }
    }

    @Test
    fun `TP-13_9 allocate vectors`() {
        for (c in cases("allocate")) {
            val parts = allocate(Money.of(big(c.s("minor")), c.s("currency")), (c["weights"] as JsonArray).map { big(it.jsonPrimitive.content) })
            assertEquals(c.toString(), (c["expected"] as JsonArray).map { big(it.jsonPrimitive.content) }, parts.map { it.minor })
        }
    }

    @Test
    fun `TP-13_9 convert vectors`() {
        for (c in cases("convert")) {
            val from = c["from"]!!.jsonObject
            val to = c["to"]!!.jsonObject
            val out = convertWithRates(
                Money.of(big(c.s("minor")), from.s("currency")),
                RateSide(parseDecimal(from.s("unitsPerUsd")), from["minorUnits"]!!.jsonPrimitive.int),
                RateSide(parseDecimal(to.s("unitsPerUsd")), to["minorUnits"]!!.jsonPrimitive.int, to.s("currency")),
            )
            assertEquals(c.toString(), big(c.s("expected")), out.minor)
            assertEquals(to.s("currency"), out.currency)
        }
    }

    @Test
    fun `TP-13_9 wire vectors`() {
        for (c in cases("wire")) {
            val m = Money.of(big(c.s("minor")), "EGP")
            if (c.s("expected") == "MoneyRangeError") {
                assertThrows(c.toString(), MoneyRangeError::class.java) { toWire(m) }
            } else {
                assertEquals(c.toString(), c.s("expected").toLong(), toWire(m))
            }
        }
    }

    @Test
    fun `TP-13_9 format vectors, normalised (A-37); a mismatch fails, nothing is skipped`() {
        val all = cases("format")
        assertTrue(all.isNotEmpty())
        for (c in all) {
            val out = formatMoney(
                Money.of(big(c.s("minor")), c.s("currency")),
                Locale.forLanguageTag(c.s("locale")),
                c["minorUnits"]!!.jsonPrimitive.int,
            )
            assertEquals(c.toString(), normalise(c.s("expected")), normalise(out))
        }
    }

    @Test
    fun `TP-13_9 Money toString is redacted`() {
        assertEquals("[redacted]", Money.of(BigInteger.TEN, "EGP").toString())
    }
}
