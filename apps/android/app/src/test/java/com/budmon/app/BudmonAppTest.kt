// F-250 BudmonApp start-up. TP-13.14.
//
// Assumed seams (see the S-13 questions): the test build config's SENTRY_DSN is varied through a
// test-only override `BudmonApp.sentryDsnOverride`, and Sentry initialisation is observed through
// io.sentry.Sentry.isEnabled().
package com.budmon.app

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.work.Configuration
import androidx.work.NetworkType
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.testing.WorkManagerTestInitHelper
import io.sentry.Sentry
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = BudmonApp::class)
class BudmonAppTest {
    private val context get() = ApplicationProvider.getApplicationContext<Context>()

    @Test
    fun `TP-13_14 onCreate enqueues the unique periodic work outbox-sync every 15 minutes, CONNECTED`() {
        WorkManagerTestInitHelper.initializeTestWorkManager(context, Configuration.Builder().build())
        (context as BudmonApp).onCreate()

        val infos = WorkManager.getInstance(context).getWorkInfosForUniqueWork("outbox-sync").get()

        assertEquals(1, infos.size)
        val info = infos.single()
        assertEquals(WorkInfo.State.ENQUEUED, info.state)
        assertEquals(NetworkType.CONNECTED, info.constraints.requiredNetworkType)
        assertEquals(TimeUnit.MINUTES.toMillis(15), info.periodicityInfo?.repeatIntervalMillis)
    }

    @Test
    fun `TP-13_14 with SENTRY_DSN empty Sentry isn't initialised`() {
        BudmonApp.sentryDsnOverride = ""
        (context as BudmonApp).onCreate()

        assertFalse(Sentry.isEnabled())
    }

    @Test
    fun `TP-13_14 with SENTRY_DSN set Sentry is initialised`() {
        BudmonApp.sentryDsnOverride = "https://k@o1.ingest.sentry.io/2"
        (context as BudmonApp).onCreate()

        assertTrue(Sentry.isEnabled())
        Sentry.close()
    }
}
