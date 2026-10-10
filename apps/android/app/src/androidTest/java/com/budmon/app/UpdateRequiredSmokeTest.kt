// Emulator smoke (release candidates, connectedDebugAndroidTest on API 34). TP-13.13. Doesn't run in
// the cloud environment or the PR check job (no emulator).
//
// Open question for the planner: how the instrumented app reaches an API stub. The draft assumes a
// MockWebServer on the device and an instrumentation argument `apiBaseUrl` that the debug build
// honours (F-264 fixes the base URL at build time, so this needs a seam).
package com.budmon.app

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.test.ext.junit.runners.AndroidJUnit4
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Before
import org.junit.Ignore
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class UpdateRequiredSmokeTest {
    private val server = MockWebServer()

    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    @Before
    fun setUp() {
        server.enqueue(
            MockResponse().setHeader("Content-Type", "application/json").setBody(
                """{"apiVersion":"1.0","android":{"minimumVersionCode":2147483647,"latestVersionCode":2147483647,"downloadUrl":null},"web":{"minimumBuild":0}}""",
            ),
        )
        server.start()
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Ignore("TP-13.13 waits for the planner: how the instrumented app is pointed at the stub API")
    @Test
    fun tp_13_13_launch_with_a_raised_minimum_shows_UpdateRequiredScreen() {
        compose.waitUntil(10_000) {
            compose.onAllNodesWithTextCount("Update Budmon to continue") > 0
        }
        compose.onNodeWithText("Update Budmon to continue").assertExists()
    }

    private fun androidx.compose.ui.test.junit4.AndroidComposeTestRule<*, *>.onAllNodesWithTextCount(text: String) =
        onAllNodes(androidx.compose.ui.test.hasText(text)).fetchSemanticsNodes().size
}
